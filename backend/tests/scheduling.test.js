const assert = require('assert');

process.env.TAVILY_API_KEY = 'test-tavily-key-p4';

const { loadPlugins } = require('../core/pluginLoader');
const toolRegistry = require('../tools/ToolRegistry');
const mockProvider = require('../core/providers/mockProvider');
const aiProvider = require('../core/providers/aiProvider');
const memory = require('../memory');
const { computeFreeSlots, isSlotFree } = require('../core/scheduling/availability');

function stubProvider(responses) {
  let call = 0;
  const respond = async () => {
    const text = Array.isArray(responses) ? responses[Math.min(call, responses.length - 1)] : responses;
    call++;
    return { text, provider: 'mock', costEstimate: 0 };
  };
  const originalMock = mockProvider.complete;
  const originalAi = aiProvider.complete;
  mockProvider.complete = respond;
  aiProvider.complete = respond;
  return () => {
    mockProvider.complete = originalMock;
    aiProvider.complete = originalAi;
  };
}

function stubTool(name, fn) {
  const original = toolRegistry.tools.get(name);
  toolRegistry.register(name, { permission: name, irreversible: false, run: fn });
  return () => { if (original) toolRegistry.register(name, original); };
}

async function main() {
  loadPlugins();

  // --- availability.js (pure logic) ---

  // A Monday at 10am, so the working week ahead is predictable.
  const monday = new Date('2026-08-24T10:00:00'); // 2026-08-24 is a Monday

  const noBusy = computeFreeSlots([], { workingDays: [1, 2, 3, 4, 5], startHour: 9, endHour: 17, slotMinutes: 30, daysAhead: 1 }, monday);
  assert(noBusy.length > 0, 'with zero busy periods, slots should be available for the rest of the working day');
  assert(noBusy.every((s) => new Date(s.start) >= monday), 'no slot should start in the past relative to "now"');
  console.log(`✓ availability: empty calendar on a working day produces free slots (${noBusy.length} found)`);

  const fullyBusy = computeFreeSlots(
    [{ start: '2026-08-24T00:00:00', end: '2026-08-25T00:00:00' }],
    { workingDays: [1, 2, 3, 4, 5], startHour: 9, endHour: 17, slotMinutes: 30, daysAhead: 1 },
    monday
  );
  assert.strictEqual(fullyBusy.length, 0, 'a busy period covering the entire day should leave zero free slots');
  console.log('✓ availability: a fully-booked day produces zero free slots');

  const partiallyBusy = computeFreeSlots(
    [{ start: '2026-08-24T09:00:00', end: '2026-08-24T12:00:00' }],
    { workingDays: [1, 2, 3, 4, 5], startHour: 9, endHour: 17, slotMinutes: 30, daysAhead: 1 },
    monday
  );
  assert(partiallyBusy.every((s) => new Date(s.start) >= new Date('2026-08-24T12:00:00')), 'no returned slot should overlap the 9-12 busy block');
  console.log('✓ availability: correctly excludes only the slots that actually overlap a busy period');

  const weekendSkipped = computeFreeSlots([], { workingDays: [1, 2, 3, 4, 5], startHour: 9, endHour: 17, slotMinutes: 30, daysAhead: 7 }, monday);
  const saturday = new Date('2026-08-29T00:00:00'); // that week's Saturday
  const sunday = new Date('2026-08-30T00:00:00');
  assert(
    weekendSkipped.every((s) => {
      const d = new Date(s.start);
      return !(d.getFullYear() === saturday.getFullYear() && d.getMonth() === saturday.getMonth() && d.getDate() === saturday.getDate()) &&
        !(d.getFullYear() === sunday.getFullYear() && d.getMonth() === sunday.getMonth() && d.getDate() === sunday.getDate());
    }),
    'weekend days must never appear when workingDays excludes them'
  );
  console.log('✓ availability: weekends are correctly excluded from working-day slots');

  assert.strictEqual(isSlotFree('2026-08-24T10:00:00', '2026-08-24T10:30:00', [{ start: '2026-08-24T09:00:00', end: '2026-08-24T09:30:00' }]), true);
  assert.strictEqual(isSlotFree('2026-08-24T10:00:00', '2026-08-24T10:30:00', [{ start: '2026-08-24T09:45:00', end: '2026-08-24T10:15:00' }]), false, 'partial overlap must count as NOT free');
  console.log('✓ availability: isSlotFree correctly detects partial overlaps as conflicts');

  // --- SchedulingAgent integration ---

  const SchedulingAgent = require('../agents/scheduling/SchedulingAgent');
  const outreachPipeline = require('../core/outreachPipeline');
  const config = require('../config');
  const agent = new SchedulingAgent();

  // Helper: create a pipeline already at RESPONSE_RECEIVED with a
  // schedulingRequestDetected=true response, ready for proposeTimes().
  async function createSchedulableRecord(idSuffix) {
    const contactEmail = `hiring+${idSuffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@acmecorp.com`;
    const opportunity = {
      id: idSuffix,
      company: 'Acme Corp',
      companyWebsite: 'https://www.acmecorp.com',
      jobTitle: 'Senior Backend Engineer',
      jobDescription: 'Backend engineer skilled in Node.js.',
      applicationUrl: 'https://www.acmecorp.com/careers/senior-backend-engineer',
      postedDate: new Date().toISOString(),
      source: 'company careers page',
      contactEmail,
    };

    let restoreSearch = stubTool('websearch.search', async () => ({
      answer: null,
      results: [{ title: 'Acme Corp Careers', url: 'https://www.acmecorp.com/careers', content: 'hiring' }],
    }));
    let restoreProvider = stubProvider(['14', '{"subject": "Re: role", "body": "Hi there, reaching out."}']);
    let restoreSend = stubTool('gmail.sendEmail', async () => ({ status: 'sent' }));
    config.outreach.automaticEnabled = true;
    const record = await outreachPipeline.processOpportunity(opportunity, { mode: outreachPipeline.MODES.AUTOMATIC });
    config.outreach.automaticEnabled = false;
    restoreSearch(); restoreProvider(); restoreSend();

    await outreachPipeline.recordResponse(record.id, {
      classification: 'Meeting request',
      schedulingRequestDetected: true,
      subject: 'Re: role',
      snippet: 'Would love to chat, when works?',
      from: contactEmail,
      threadId: 'thread-xyz',
      messageId: 'msg-xyz',
      receivedAt: new Date().toISOString(),
    });

    return { pipelineId: record.id, contactEmail };
  }

  // Case 1: proposeTimes refuses when there's no scheduling-request response.
  {
    const contactEmail = `hiring+noreq-${Date.now()}@acmecorp.com`;
    const restoreSearch = stubTool('websearch.search', async () => ({ answer: null, results: [{ title: 'x', url: 'https://www.acmecorp.com/careers', content: 'x' }] }));
    const restoreProvider = stubProvider(['14', '{"subject": "s", "body": "b"}']);
    const restoreSend = stubTool('gmail.sendEmail', async () => ({ status: 'sent' }));
    config.outreach.automaticEnabled = true;
    const record = await outreachPipeline.processOpportunity({
      id: 'p4-noreq', company: 'Acme Corp', companyWebsite: 'https://www.acmecorp.com', jobTitle: 'Engineer',
      jobDescription: 'x', applicationUrl: 'https://www.acmecorp.com/careers/x', postedDate: new Date().toISOString(),
      source: 'company careers page', contactEmail,
    }, { mode: outreachPipeline.MODES.AUTOMATIC });
    config.outreach.automaticEnabled = false;
    restoreSearch(); restoreProvider(); restoreSend();

    await assert.rejects(() => agent.proposeTimes(record.id), /no response with schedulingRequestDetected/);
    console.log('✓ SchedulingAgent: proposeTimes refuses to propose times when nobody actually asked to schedule');
  }

  // Case 2: proposeTimes with an empty calendar - proposes real free slots, approval-gated, never sends directly.
  {
    const { pipelineId } = await createSchedulableRecord('p4-propose');
    const restoreEvents = stubTool('googlecalendar.listEvents', async () => ({ busyPeriods: [] }));
    const restoreProvider = stubProvider('{"subject": "Re: role - times", "body": "How about Tuesday at 2pm or Wednesday at 10am?"}');
    let replySent = false;
    const restoreReply = stubTool('gmail.replyToThread', async () => { replySent = true; return { status: 'replied' }; });

    const result = await agent.proposeTimes(pipelineId);
    restoreEvents(); restoreProvider(); restoreReply();

    assert.strictEqual(result.proposed, true);
    assert(result.slots.length > 0, 'should propose at least one slot from an empty calendar');
    assert(result.approvalTaskId, 'should create an approval task, not send directly');
    assert.strictEqual(replySent, false, 'must NEVER reply/send directly - always through approval');
    console.log('✓ SchedulingAgent: proposeTimes computes real free slots and creates an approval-gated reply, never sends directly');

    const updatedTask = await memory.getTask(pipelineId);
    assert.strictEqual(updatedTask.payload.stage, outreachPipeline.STAGES.CALL_REQUESTED);
    assert(updatedTask.payload.proposedSlots.length > 0);
    console.log('✓ SchedulingAgent: proposeTimes moves the pipeline to CALL_REQUESTED with proposed slots stored');

    const approvalTask = await memory.getTask(result.approvalTaskId);
    assert.strictEqual(approvalTask.status, 'pending_approval');
    assert.strictEqual(approvalTask.toolCall.tool, 'gmail.replyToThread');
    console.log('✓ SchedulingAgent: the created approval task uses the standard gmail.replyToThread gate');
  }

  // Case 3: proposeTimes with a fully-booked calendar returns proposed:false, no approval task created.
  {
    const { pipelineId } = await createSchedulableRecord('p4-full');
    const now = new Date();
    const farFuture = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
    const restoreEvents = stubTool('googlecalendar.listEvents', async () => ({
      busyPeriods: [{ start: now.toISOString(), end: farFuture.toISOString() }], // covers the entire lookahead window
    }));

    const result = await agent.proposeTimes(pipelineId);
    restoreEvents();

    assert.strictEqual(result.proposed, false);
    assert(!result.approvalTaskId, 'no approval task should be created when there is nothing to propose');
    console.log('✓ SchedulingAgent: proposeTimes correctly reports no availability instead of proposing fake slots');
  }

  // Case 4: confirmBooking refuses a slot that was never actually proposed.
  {
    const { pipelineId } = await createSchedulableRecord('p4-fakeslot');
    const restoreEvents = stubTool('googlecalendar.listEvents', async () => ({ busyPeriods: [] }));
    const restoreProvider = stubProvider('{"subject": "s", "body": "b"}');
    await agent.proposeTimes(pipelineId);
    restoreEvents(); restoreProvider();

    const fakeSlot = { start: '2099-01-01T00:00:00.000Z', end: '2099-01-01T00:30:00.000Z' };
    await assert.rejects(() => agent.confirmBooking(pipelineId, fakeSlot), /not one of the times actually proposed/);
    console.log('✓ SchedulingAgent: confirmBooking refuses to book a time that was never actually offered');
  }

  // Case 5: confirmBooking on a genuinely proposed, still-free slot creates an approval-gated calendar event with reminders.
  {
    const { pipelineId } = await createSchedulableRecord('p4-confirm');
    const restoreEvents1 = stubTool('googlecalendar.listEvents', async () => ({ busyPeriods: [] }));
    const restoreProvider1 = stubProvider('{"subject": "s", "body": "b"}');
    const proposeResult = await agent.proposeTimes(pipelineId);
    restoreEvents1(); restoreProvider1();

    const chosen = proposeResult.slots[0];
    const restoreEvents2 = stubTool('googlecalendar.listEvents', async () => ({ busyPeriods: [] })); // still free on re-check
    let createEventCalled = false;
    let createEventArgs = null;
    const restoreCreate = stubTool('googlecalendar.createEvent', async (args) => {
      createEventCalled = true;
      createEventArgs = args;
      return { status: 'scheduled', id: 'evt-123' };
    });

    const bookResult = await agent.confirmBooking(pipelineId, chosen);
    restoreEvents2(); restoreCreate();

    assert.strictEqual(bookResult.pendingApproval, true);
    assert(bookResult.approvalTaskId, 'should create an approval task for the calendar event');
    assert.strictEqual(createEventCalled, false, 'must NEVER create the calendar event directly - always through approval');
    console.log('✓ SchedulingAgent: confirmBooking creates an approval-gated calendar event, never books directly');

    const approvalTask = await memory.getTask(bookResult.approvalTaskId);
    assert.strictEqual(approvalTask.toolCall.tool, 'googlecalendar.createEvent');
    assert.deepStrictEqual(approvalTask.payload.reminderMinutesBefore, [1440, 60, 15]);
    console.log('✓ SchedulingAgent: the calendar event payload includes the configured 24h/1h/15m reminders');
  }

  // Case 6: confirmBooking detects a race - slot was proposed but got booked elsewhere before confirmation.
  {
    const { pipelineId } = await createSchedulableRecord('p4-race');
    const restoreEvents1 = stubTool('googlecalendar.listEvents', async () => ({ busyPeriods: [] }));
    const restoreProvider1 = stubProvider('{"subject": "s", "body": "b"}');
    const proposeResult = await agent.proposeTimes(pipelineId);
    restoreEvents1(); restoreProvider1();

    const chosen = proposeResult.slots[0];
    // On re-check, that exact slot is now busy (something else booked it in the meantime).
    const restoreEvents2 = stubTool('googlecalendar.listEvents', async () => ({ busyPeriods: [{ start: chosen.start, end: chosen.end }] }));
    let createEventCalled = false;
    const restoreCreate = stubTool('googlecalendar.createEvent', async () => { createEventCalled = true; return { status: 'scheduled' }; });

    const bookResult = await agent.confirmBooking(pipelineId, chosen);
    restoreEvents2(); restoreCreate();

    assert.strictEqual(bookResult.booked, false);
    assert(!bookResult.approvalTaskId, 'must not create a booking approval task for a slot that is no longer free');
    assert.strictEqual(createEventCalled, false);
    console.log('✓ SchedulingAgent: confirmBooking re-checks the live calendar and catches a slot filled since it was proposed');
  }

  // Case 7: markCallScheduled finalizes the pipeline stage after the calendar approval is actually executed.
  {
    const { pipelineId } = await createSchedulableRecord('p4-finalize');
    const restoreEvents1 = stubTool('googlecalendar.listEvents', async () => ({ busyPeriods: [] }));
    const restoreProvider1 = stubProvider('{"subject": "s", "body": "b"}');
    const proposeResult = await agent.proposeTimes(pipelineId);
    restoreEvents1(); restoreProvider1();

    const chosen = proposeResult.slots[0];
    const restoreEvents2 = stubTool('googlecalendar.listEvents', async () => ({ busyPeriods: [] }));
    const restoreCreate = stubTool('googlecalendar.createEvent', async () => ({ status: 'scheduled', id: 'evt-999' }));
    await agent.confirmBooking(pipelineId, chosen);
    restoreEvents2(); restoreCreate();

    await agent.markCallScheduled(pipelineId, { status: 'scheduled', id: 'evt-999' });
    const finalTask = await memory.getTask(pipelineId);
    assert.strictEqual(finalTask.payload.stage, outreachPipeline.STAGES.CALL_SCHEDULED);
    assert.strictEqual(finalTask.payload.calendarEventResult.id, 'evt-999');
    console.log('✓ SchedulingAgent: markCallScheduled correctly finalizes the pipeline as CALL_SCHEDULED with the real event id');
  }

  console.log('\nAll scheduling (Phase 4) checks passed.');
}

main().catch((err) => {
  console.error('✗ scheduling.test.js failed:', err);
  process.exit(1);
});