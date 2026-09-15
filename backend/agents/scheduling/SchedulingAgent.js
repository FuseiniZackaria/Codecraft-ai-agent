const BaseAgent = require('../base/BaseAgent');
const memory = require('../../memory');
const config = require('../../config');
const toolRegistry = require('../../tools/ToolRegistry');
const activityLog = require('../../core/activityLog');
const { selectProvider } = require('../../core/router');
const { businessContextLine } = require('../../core/businessContext');
const { computeFreeSlots, isSlotFree } = require('../../core/scheduling/availability');
const outreachPipeline = require('../../core/outreachPipeline');

/**
 * SchedulingAgent - Phase 4 of the Verified Job Outreach system.
 *
 * Two jobs, both gated the same way everything else in this codebase is:
 *   1. proposeTimes(pipelineId) - checks the real calendar, computes
 *      genuinely free slots, and drafts a reply proposing them. Creates an
 *      approval-gated reply, never sends on its own.
 *   2. confirmBooking(pipelineId, slot) - re-verifies the chosen slot is
 *      still free (avoids a race where something else filled it between
 *      proposing and confirming), then creates an approval-gated calendar
 *      event with reminders. Booking on someone's real calendar is treated
 *      as a distinctly high-stakes action - it ALWAYS requires approval,
 *      regardless of outreach mode (manual/semi-automatic/automatic), unlike
 *      outreach emails which automatic mode can auto-send under strict
 *      conditions. That's a deliberate, documented difference: an email is
 *      easy to apologize for; a calendar invite to a real person is not.
 *
 * Never invents a time slot - every slot offered or booked is grounded in
 * an actual read of the calendar, never guessed at by the LLM.
 */
class SchedulingAgent extends BaseAgent {
  constructor() {
    super({
      key: 'scheduling',
      role: 'Scheduling Agent',
      goals: ['Propose real available times and book calendar events without ever double-booking or inventing availability'],
      tools: ['googlecalendar.listEvents', 'googlecalendar.createEvent', 'gmail.replyToThread'],
    });
  }

  /**
   * Reads the real calendar for the configured lookahead window and
   * computes genuinely free slots. Pure read + deterministic math - no
   * side effects, safe to call as often as needed.
   */
  async checkAvailability() {
    const now = new Date();
    const rangeEnd = new Date(now.getTime() + config.scheduling.daysAhead * 24 * 60 * 60 * 1000);

    const result = await toolRegistry.call(
      'googlecalendar.listEvents',
      { timeMin: now.toISOString(), timeMax: rangeEnd.toISOString() },
      { role: this.role }
    );
    const busyPeriods = result?.busyPeriods || [];

    const freeSlots = computeFreeSlots(busyPeriods, {
      workingDays: config.scheduling.workingDays,
      startHour: config.scheduling.startHour,
      endHour: config.scheduling.endHour,
      slotMinutes: config.scheduling.slotMinutes,
      daysAhead: config.scheduling.daysAhead,
    }, now);

    return { busyPeriods, freeSlots };
  }

  /**
   * Proposes real available times to a contact who's asked to schedule a
   * call. Requires the pipeline to have a response with
   * schedulingRequestDetected=true - refuses to propose times out of thin
   * air for a pipeline nobody actually asked to schedule with.
   */
  async proposeTimes(pipelineId) {
    const task = await memory.getTask(pipelineId);
    if (!task || !task.payload) {
      throw new Error(`No pipeline found for id "${pipelineId}"`);
    }
    const state = task.payload;

    const responses = state.responses || [];
    const schedulingResponse = [...responses].reverse().find((r) => r.schedulingRequestDetected);
    if (!schedulingResponse) {
      throw new Error(`Pipeline "${pipelineId}" has no response with schedulingRequestDetected=true - nothing to propose times for`);
    }

    const { freeSlots } = await this.checkAvailability();
    if (freeSlots.length === 0) {
      await activityLog.record(this.role, 'no_availability', state.opportunity?.company || '', { pipelineId });
      return { proposed: false, reason: 'No free slots found in the configured availability window' };
    }

    const slotsToOffer = freeSlots.slice(0, config.scheduling.slotsToPropose);

    const draft = await this.draftProposal(state.opportunity, slotsToOffer);

    const approvalTask = await this.createApprovalTask({
      instruction: `Propose call times to ${state.opportunity.contactEmail} re: ${state.opportunity.jobTitle} at ${state.opportunity.company}`,
      tool: 'gmail.replyToThread',
      payload: {
        threadId: schedulingResponse.threadId,
        recipientEmail: state.opportunity.contactEmail,
        body: draft.body,
      },
    });

    await outreachPipeline.updateState(pipelineId, {
      stage: outreachPipeline.STAGES.CALL_REQUESTED,
      proposedSlots: slotsToOffer,
      proposalApprovalTaskId: approvalTask.id,
    });

    await activityLog.record(this.role, 'times_proposed', state.opportunity.company || '', {
      pipelineId,
      slotsOffered: slotsToOffer.length,
      approvalTaskId: approvalTask.id,
    });

    return { proposed: true, slots: slotsToOffer, approvalTaskId: approvalTask.id };
  }

  /**
   * Confirms a specific slot the contact selected. The slot must be one of
   * the ones this agent actually proposed (never books an arbitrary,
   * un-verified time) AND is re-checked against the live calendar right
   * before booking, closing the race window between "we offered it" and
   * "they picked it" during which something else could have filled it.
   */
  async confirmBooking(pipelineId, chosenSlot) {
    const task = await memory.getTask(pipelineId);
    if (!task || !task.payload) {
      throw new Error(`No pipeline found for id "${pipelineId}"`);
    }
    const state = task.payload;

    const proposedSlots = state.proposedSlots || [];
    const matchesProposed = proposedSlots.some((s) => s.start === chosenSlot.start && s.end === chosenSlot.end);
    if (!matchesProposed) {
      throw new Error('Chosen slot was not one of the times actually proposed - refusing to book an unverified time');
    }

    // Re-check against the LIVE calendar, not the stale proposedSlots
    // snapshot - something could have booked this slot in the meantime.
    const { busyPeriods } = await this.checkAvailability();
    if (!isSlotFree(chosenSlot.start, chosenSlot.end, busyPeriods)) {
      await outreachPipeline.updateState(pipelineId, { bookingConflict: true, conflictDetectedAt: new Date().toISOString() });
      await activityLog.record(this.role, 'booking_conflict', state.opportunity?.company || '', { pipelineId, chosenSlot });
      return { booked: false, reason: 'That slot is no longer free - it was booked elsewhere since it was proposed' };
    }

    const title = `Intro Call — CodeCraft × ${state.opportunity.company}`;
    const approvalTask = await this.createApprovalTask({
      instruction: `Create calendar event: ${title}`,
      tool: 'googlecalendar.createEvent',
      payload: {
        title,
        startTime: chosenSlot.start,
        endTime: chosenSlot.end,
        timezone: config.scheduling.timezone || undefined,
        description: `Intro call re: ${state.opportunity.jobTitle} at ${state.opportunity.company}.\n\nOriginal outreach: ${state.draft?.subject || ''}`,
        attendeeEmails: [state.opportunity.contactEmail],
        reminderMinutesBefore: config.scheduling.reminderMinutesBefore,
      },
    });

    await outreachPipeline.updateState(pipelineId, {
      chosenSlot,
      calendarApprovalTaskId: approvalTask.id,
    });

    await activityLog.record(this.role, 'booking_requested', state.opportunity.company || '', {
      pipelineId,
      chosenSlot,
      approvalTaskId: approvalTask.id,
    });

    return { booked: false, pendingApproval: true, approvalTaskId: approvalTask.id };
  }

  /**
   * Called once the calendar-event approval task has actually been
   * executed (mirrors outreachPipeline.markSent's role for outreach
   * emails) - finalizes the pipeline as CALL_SCHEDULED with the real
   * calendar event id attached.
   */
  async markCallScheduled(pipelineId, eventResult) {
    return outreachPipeline.updateState(pipelineId, {
      stage: outreachPipeline.STAGES.CALL_SCHEDULED,
      calendarEventResult: eventResult,
      scheduledAt: new Date().toISOString(),
    });
  }

  /**
   * Drafts the times-proposal reply. Grounded ONLY in the actual computed
   * slots - the prompt hands the LLM the exact ISO times and instructs it
   * to phrase them naturally, never to invent or adjust them.
   */
  async draftProposal(opportunity, slots) {
    const slotList = slots.map((s) => `${s.start} to ${s.end}`).join('\n');

    const provider = selectProvider({});
    const result = await provider.complete({
      system:
        `${businessContextLine()}You are replying to someone who agreed to schedule a call, offering them specific ` +
        'available times. Rephrase the exact times below naturally and readably (e.g. "Tuesday at 2pm") - do NOT ' +
        'invent, add, or change any time, only reword the ones given. Keep it short and friendly. ' +
        'Respond with ONLY a JSON object: {"subject": "...", "body": "..."}',
      prompt: `Available times (ISO, do not alter):\n${slotList}\n\nRe: ${opportunity.jobTitle} at ${opportunity.company}`,
      maxTokens: 400,
    });

    try {
      const match = result.text.match(/\{[\s\S]*\}/);
      const parsed = match ? JSON.parse(match[0]) : null;
      if (parsed && parsed.subject && parsed.body) return parsed;
    } catch {
      // fall through to error below
    }
    throw new Error('Proposal drafting did not return valid subject/body JSON');
  }
}

module.exports = SchedulingAgent;