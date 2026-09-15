const BaseAgent = require('../base/BaseAgent');
const { selectProvider } = require('../../core/router');
const { getAllowedRoots } = require('../../core/computerOperator/pathSafety');
const { findDirectoriesByName } = require('../../core/computerOperator/directoryInspect');
const { searchFiles } = require('../../core/computerOperator/fileSearch');
const { findAppsByName } = require('../../core/computerOperator/appLaunch');

/**
 * ComputerOperatorAgent - Stages 1-10 of the local computer-operator system:
 * filesystem search (1), directory inspection (2), opening files (3),
 * opening folders (4), large-file analysis (5), old-file analysis (6),
 * duplicate detection (7), Recycle Bin deletion (8), audit logging (9, via
 * BaseAgent's activityLog.record on every step), basic app launching (10).
 * This file accumulates new capabilities across later stages - every
 * capability added here always goes through the allowlist enforced in
 * core/computerOperator/pathSafety.js, no exceptions.
 *
 * Search/list/open-safe-file-types/open-folder/large-file-analysis/
 * old-file-analysis/duplicate-detection/launch-approved-app are all
 * non-gated (no approval needed) - equivalent to the user doing these
 * things themselves with full access they already have. Opening an
 * executable/script via openFile is a HARD BLOCK inside
 * core/computerOperator/openFile.js itself, not an approval option -
 * launching an app is a SEPARATE, narrower allowlist
 * (COMPUTER_ALLOWED_APPS, enforced in appLaunch.js) rather than a loosening
 * of that block; being inside an allowed root never implies launch
 * permission. Deletion is different from everything else here - it's the
 * first genuinely irreversible action, and always goes through
 * this.createApprovalTask() rather than a direct tool_call step.
 */
class ComputerOperatorAgent extends BaseAgent {
  constructor() {
    super({
      key: 'computer-operator',
      role: 'Computer Operator Agent',
      goals: ['Help the user find, inspect, open, and (with approval) delete files/folders on their own computer, strictly within folders they have explicitly allowed'],
      tools: ['computer.searchFiles', 'computer.listDirectory', 'computer.openFile', 'computer.openFolder', 'computer.findLargeFiles', 'computer.findOldFiles', 'computer.findDuplicateFiles', 'computer.deleteToRecycleBin', 'computer.launchApp'],
    });
  }

  formatHistoryContext(history = []) {
    if (!history.length) return '';
    return (
      `Recent conversation for context (the current message may be a short follow-up to this, e.g. ` +
      `"yes full list" or "open the first one" answering something just asked):\n${history
        .slice(-6)
        .map((h) => `${h.role}: ${h.content}`)
        .join('\n')}\n\n---\n\n`
    );
  }

  async plan(task) {
    const allowedRoots = getAllowedRoots();
    if (allowedRoots.length === 0) {
      return [
        {
          type: 'llm_call',
          maxTokens: 150,
          instruction:
            'Tell the user, in one short, friendly sentence, that local computer file access is not configured ' +
            'yet, and they need to set COMPUTER_ALLOWED_ROOTS in their .env file (listing the folder(s) they want ' +
            'this agent able to search) before this will work.',
        },
      ];
    }

    const historyContext = this.formatHistoryContext(task.history);

    let extracted = null;
    try {
      const provider = selectProvider({});
      const result = await provider.complete({
        maxTokens: 250,
        system:
          'Figure out what the user wants to do with their computer. Conversation context is provided below ONLY ' +
          'for the case where the CURRENT message alone is ambiguous or an incomplete follow-up (e.g. it ' +
          'references something by name that was just mentioned/listed, like "open the first one" or "yes, that ' +
          'one"). If the current message is ALREADY clear and complete on its own - a full request with its own ' +
          'subject (e.g. "show me files I haven\'t touched in a year", "find my biggest files") - IGNORE the ' +
          'conversation history entirely and extract only from the current message. Never pull a keyword, ' +
          'filename, or topic from earlier conversation history into your extraction unless the current message ' +
          'is genuinely incomplete without it. Respond with ONLY a JSON object: {"mode": ' +
          '"search"|"list"|"open"|"openFolder"|"launchApp"|"largeFiles"|"oldFiles"|"duplicates"|"delete"|' +
          '"deleteFolder", "query": "...", "extensions": ["ext1"], "folderName": "...", "fileName": "...", ' +
          '"minSizeMB": 0, "minAgeDays": 0}. The word "open" is a strong, decisive signal: if the message says ' +
          '"open X", default to "openFolder" (if X is plainly a folder/location) or "open" (if X is plainly a ' +
          'specific file) - NOT "list", even if showing contents would also be interesting. Use "launchApp" ' +
          'instead of "open"/"openFolder" specifically when the user wants to START/RUN/LAUNCH a named PROGRAM/ ' +
          'APPLICATION (e.g. "launch Telegram Desktop", "open Notepad", "start Telegram") rather than open a ' +
          'document/file/folder - set fileName to the app\'s name as they wrote it. Only apps explicitly ' +
          'pre-approved by the user can actually launch; if genuinely unsure whether something is a document/ ' +
          'folder vs. a program, prefer "open"/"openFolder". Reserve "list" for phrasing that asks to SEE/SHOW/ ' +
          'describe contents (e.g. "what\'s in X", "show me what\'s in X"). Use "largeFiles" for anything about ' +
          'disk space, biggest/largest files, or what\'s taking up storage (set minSizeMB if a size was ' +
          'mentioned, otherwise 0). Use "oldFiles" for anything about old/stale/outdated files, or files not ' +
          'touched/used/modified in a while (set minAgeDays if a timeframe was mentioned - e.g. "a year" -> 365, ' +
          '"6 months" -> 180 - otherwise 0). Use "duplicates" for anything about duplicate/repeated/copy files, ' +
          'wasted space from copies, or finding identical files. Use "delete" when the user wants to DELETE/ ' +
          'REMOVE/TRASH a specific named FILE (set fileName). Use "deleteFolder" for deleting a specific named ' +
          'FOLDER (set folderName). Deletion always requires the user to name (or have just seen named) a ' +
          'SPECIFIC file/folder - never infer a whole batch like "delete all the duplicates" without a specific ' +
          'name; if that vague, do not set mode to "delete"/"deleteFolder" at all. "X" does not need to say ' +
          '"file" or "folder" explicitly - a specific name mentioned earlier in the conversation (e.g. "Telegram ' +
          'Desktop") is enough context to resolve it as a folderName/fileName, but ONLY when the current message ' +
          'is genuinely referencing something from that context, not for a fully self-contained request like a ' +
          'disk-space or old-files query.',
        prompt: `${historyContext}Current message: ${task.instruction}`,
      });
      const match = result.text.match(/\{[\s\S]*\}/);
      extracted = match ? JSON.parse(match[0]) : null;
    } catch (err) {
      console.warn(`[ComputerOperatorAgent] extraction failed: ${err.message}`);
    }

    const hasQuery = extracted?.query && typeof extracted.query === 'string' && extracted.query.trim();
    const hasFolderName = extracted?.folderName && typeof extracted.folderName === 'string' && extracted.folderName.trim();
    const hasFileName = extracted?.fileName && typeof extracted.fileName === 'string' && extracted.fileName.trim();
    const isLargeFilesMode = extracted?.mode === 'largeFiles';
    const isOldFilesMode = extracted?.mode === 'oldFiles';
    const isDuplicatesMode = extracted?.mode === 'duplicates';
    const isDeleteFileMode = extracted?.mode === 'delete';
    const isDeleteFolderMode = extracted?.mode === 'deleteFolder';
    const isLaunchAppMode = extracted?.mode === 'launchApp';

    if (!extracted || (!hasQuery && !hasFolderName && !hasFileName && !isLargeFilesMode && !isOldFilesMode && !isDuplicatesMode)) {
      return [
        {
          type: 'llm_call',
          maxTokens: 400,
          instruction: `Ask the user to clarify what they want to do with their computer - could not tell from: "${task.instruction}"${
            historyContext ? ' (even considering the recent conversation)' : ''
          }. Keep it to 2-3 short clarifying options, not an exhaustive breakdown - a long list risks getting cut off.`,
        },
      ];
    }

    if (isLargeFilesMode) {
      return this.planLargeFiles(extracted.minSizeMB);
    }

    if (isOldFilesMode) {
      return this.planOldFiles(extracted.minAgeDays);
    }

    if (isDuplicatesMode) {
      return this.planDuplicates();
    }

    if (isDeleteFileMode && hasFileName) {
      return this.planDeleteFile(extracted.fileName);
    }

    if (isDeleteFolderMode && hasFolderName) {
      return this.planDeleteFolder(extracted.folderName);
    }

    if (isLaunchAppMode && hasFileName) {
      return this.planLaunchApp(extracted.fileName);
    }

    if (extracted.mode === 'open' && hasFileName) {
      return this.planOpenFile(extracted.fileName);
    }

    if (extracted.mode === 'openFolder' && hasFolderName) {
      return this.planOpenFolder(extracted.folderName);
    }

    if (extracted.mode === 'list' && hasFolderName) {
      return this.planDirectoryListing(extracted.folderName);
    }

    if (!hasQuery) {
      return [
        {
          type: 'llm_call',
          maxTokens: 150,
          instruction: `Ask the user to clarify what filename or keyword to search for - "${task.instruction}" didn't give a clear one.`,
        },
      ];
    }

    return [
      {
        type: 'tool_call',
        tool: 'computer.searchFiles',
        args: { query: extracted.query, extensions: Array.isArray(extracted.extensions) ? extracted.extensions : [] },
      },
      {
        type: 'llm_call',
        maxTokens: 600,
        instruction:
          'The previous step\'s result is a JSON object with the actual search results (path/name/size/modified ' +
          'date per match). Summarize it for the user in a friendly, concise way - list what was found (name and ' +
          'full path for each, up to 15 items), or clearly say nothing matched if the results array is empty. If ' +
          '"truncated" is true, mention there were more results than shown. If "skippedFolders" has entries, ' +
          'briefly note them and explain what each actual reason means (shown in parentheses after each folder) - ' +
          '"ENOENT" means the folder doesn\'t exist at that path at all (common when OneDrive has redirected a ' +
          'folder like Desktop/Documents to a different location); "EPERM"/"EACCES" means a genuine permission ' +
          'issue. Never assume it\'s a permission problem without checking which code is actually shown.',
      },
    ];
  }

  planLargeFiles(minSizeMB) {
    const args = {};
    if (typeof minSizeMB === 'number' && minSizeMB > 0) args.minSizeMB = minSizeMB;

    return [
      { type: 'tool_call', tool: 'computer.findLargeFiles', args },
      {
        type: 'llm_call',
        maxTokens: 1500,
        instruction:
          'The previous step\'s result is a JSON object: "results" (the largest files found, path/name/sizeBytes/' +
          'modifiedAt, already sorted biggest first), "totalScanned" (how many real files were examined in ' +
          'total), "totalSizeBytes" (their combined size). Present this to the user in a friendly way - show ' +
          'each result\'s name, full path, and size in a human-readable unit (KB/MB/GB, not raw bytes). Mention ' +
          'totalScanned and totalSizeBytes (converted to a readable unit) as useful context on how much was ' +
          'actually looked at. If results is empty, say so honestly rather than implying nothing large exists ' +
          'anywhere on their machine - only their allowed folders were checked.',
      },
    ];
  }

  planOldFiles(minAgeDays) {
    const args = {};
    if (typeof minAgeDays === 'number' && minAgeDays > 0) args.minAgeDays = minAgeDays;

    return [
      { type: 'tool_call', tool: 'computer.findOldFiles', args },
      {
        type: 'llm_call',
        maxTokens: 1500,
        instruction:
          'The previous step\'s result is a JSON object: "results" (the oldest files found, path/name/sizeBytes/' +
          'modifiedAt/ageDays, already sorted oldest first), "totalScanned" (how many real files were examined ' +
          'in total). Present this to the user in a friendly way - show each result\'s name, full path, and how ' +
          'long ago it was last modified (e.g. "2.7 years ago", not just a raw day count). Be careful NOT to ' +
          'claim or imply any of these files are "unused", "junk", or "safe to delete" - last-modified date only ' +
          'says when a file was last touched, not whether it\'s still needed; a deliberately kept archive is ' +
          'exactly as "old" as true clutter. Just present the honest list and let the user judge each one. If ' +
          'results is empty, say so honestly.',
      },
    ];
  }

  planDuplicates() {
    return [
      { type: 'tool_call', tool: 'computer.findDuplicateFiles', args: {} },
      {
        type: 'llm_call',
        maxTokens: 1500,
        instruction:
          'The previous step\'s result is a JSON object: "duplicateGroups" (each a set of files with identical ' +
          'content - sizeBytes and an array of files with path/name/modifiedAt), "totalGroupsFound", ' +
          '"totalScanned", "wastedBytes" (total space these duplicate copies take up beyond the first copy of ' +
          'each), "skippedLargeFiles" (files too large to check, listed by path). Present this to the user in a ' +
          'friendly way - for each group, show all the file paths that are identical copies of each other and ' +
          'the size, and mention wastedBytes converted to a readable unit (KB/MB/GB) as the total reclaimable ' +
          'space if duplicates were cleared. If skippedLargeFiles is non-empty, briefly mention some very large ' +
          'files were not checked. Never tell the user which copy to delete or imply any are safe to remove - ' +
          'being identical copies doesn\'t mean either one is disposable (one might be the version actively in ' +
          'use); just present the real, verified duplicate groups and let the user decide. If duplicateGroups is ' +
          'empty, say so honestly.',
      },
    ];
  }

  async planDeleteFile(fileName) {
    let searchResult;
    try {
      searchResult = searchFiles({ query: fileName, maxResults: 10 });
    } catch (err) {
      return [{ type: 'llm_call', maxTokens: 150, instruction: `Tell the user this failed: ${err.message}` }];
    }

    const matches = searchResult.results;

    if (matches.length === 0) {
      return [
        {
          type: 'llm_call',
          maxTokens: 150,
          instruction: `Tell the user, honestly, that no file matching "${fileName}" was found within their allowed folders - nothing was deleted.`,
        },
      ];
    }

    if (matches.length > 1) {
      const list = matches.map((m) => m.path).join(', ');
      return [
        {
          type: 'llm_call',
          maxTokens: 300,
          instruction: `Multiple files matched "${fileName}": ${list}. Ask the user which specific one they mean before anything is deleted - never pick one for them, and make clear nothing has been deleted yet.`,
        },
      ];
    }

    const target = matches[0];
    await this.createApprovalTask({
      instruction: `Move to Recycle Bin: ${target.path}`,
      tool: 'computer.deleteToRecycleBin',
      payload: { paths: [target.path] },
    });

    return [
      {
        type: 'llm_call',
        maxTokens: 150,
        instruction: `Tell the user a request to move "${target.name}" (${target.path}) to the Recycle Bin has been created and is waiting on the Tasks page for their approval - nothing has been deleted yet.`,
      },
    ];
  }

  async planDeleteFolder(folderName) {
    let matches;
    try {
      matches = findDirectoriesByName(folderName);
    } catch (err) {
      return [{ type: 'llm_call', maxTokens: 150, instruction: `Tell the user this failed: ${err.message}` }];
    }

    if (matches.length === 0) {
      return [
        {
          type: 'llm_call',
          maxTokens: 150,
          instruction: `Tell the user, honestly, that no folder matching "${folderName}" was found within their allowed folders - nothing was deleted.`,
        },
      ];
    }

    if (matches.length > 1) {
      return [
        {
          type: 'llm_call',
          maxTokens: 250,
          instruction: `Multiple folders matched "${folderName}": ${matches.join(', ')}. Ask the user which specific one they mean before anything is deleted - never pick one for them, and make clear nothing has been deleted yet.`,
        },
      ];
    }

    const target = matches[0];
    await this.createApprovalTask({
      instruction: `Move to Recycle Bin: ${target}`,
      tool: 'computer.deleteToRecycleBin',
      payload: { paths: [target] },
    });

    return [
      {
        type: 'llm_call',
        maxTokens: 150,
        instruction: `Tell the user a request to move the folder "${target}" to the Recycle Bin has been created and is waiting on the Tasks page for their approval - nothing has been deleted yet.`,
      },
    ];
  }

  planDirectoryListing(folderName) {
    let matches;
    try {
      matches = findDirectoriesByName(folderName);
    } catch (err) {
      return [{ type: 'llm_call', maxTokens: 150, instruction: `Tell the user this failed: ${err.message}` }];
    }

    if (matches.length === 0) {
      return [
        {
          type: 'llm_call',
          maxTokens: 150,
          instruction:
            `Tell the user, honestly and clearly, that no folder matching "${folderName}" was found within their ` +
            `allowed folders - it may not exist there, or the folder containing it hasn't been added to ` +
            `COMPUTER_ALLOWED_ROOTS yet.`,
        },
      ];
    }

    if (matches.length > 1) {
      return [
        {
          type: 'llm_call',
          maxTokens: 250,
          instruction:
            `Multiple folders matched "${folderName}": ${matches.join(', ')}. Ask the user which specific one ` +
            `they mean, listing these exact real options - never pick one for them.`,
        },
      ];
    }

    return [
      { type: 'tool_call', tool: 'computer.listDirectory', args: { dirPath: matches[0] } },
      {
        type: 'llm_call',
        maxTokens: 700,
        instruction:
          'The previous step\'s result is a JSON object listing the immediate contents of a folder (name/path/' +
          'isDirectory/sizeBytes/modifiedAt per entry). Present it to the user as a clean, friendly list - ' +
          'distinguish folders from files, mention file sizes in a human-readable way (KB/MB) where helpful, and ' +
          'clearly say if the folder is empty. If "truncated" is true, mention there was more than shown.',
      },
    ];
  }

  planOpenFolder(folderName) {
    let matches;
    try {
      matches = findDirectoriesByName(folderName);
    } catch (err) {
      return [{ type: 'llm_call', maxTokens: 150, instruction: `Tell the user this failed: ${err.message}` }];
    }

    if (matches.length === 0) {
      return [
        {
          type: 'llm_call',
          maxTokens: 150,
          instruction:
            `Tell the user, honestly and clearly, that no folder matching "${folderName}" was found within their ` +
            `allowed folders.`,
        },
      ];
    }

    if (matches.length > 1) {
      return [
        {
          type: 'llm_call',
          maxTokens: 250,
          instruction:
            `Multiple folders matched "${folderName}": ${matches.join(', ')}. Ask the user which specific one ` +
            `they mean, listing these exact real options - never pick one for them.`,
        },
      ];
    }

    return [
      { type: 'tool_call', tool: 'computer.openFolder', args: { dirPath: matches[0] } },
      {
        type: 'llm_call',
        maxTokens: 200,
        instruction:
          `The previous step's result confirms whether the folder was opened, or if it failed, why. Tell the ` +
          `user plainly what happened, in one or two sentences.`,
      },
    ];
  }

  planOpenFile(fileName) {
    let searchResult;
    try {
      searchResult = searchFiles({ query: fileName, maxResults: 10 });
    } catch (err) {
      return [{ type: 'llm_call', maxTokens: 150, instruction: `Tell the user this failed: ${err.message}` }];
    }

    const matches = searchResult.results;

    if (matches.length === 0) {
      return [
        {
          type: 'llm_call',
          maxTokens: 150,
          instruction:
            `Tell the user, honestly and clearly, that no file matching "${fileName}" was found within their ` +
            `allowed folders.`,
        },
      ];
    }

    if (matches.length > 1) {
      const list = matches.map((m) => m.path).join(', ');
      return [
        {
          type: 'llm_call',
          maxTokens: 300,
          instruction: `Multiple files matched "${fileName}": ${list}. Ask the user which specific one they mean, listing these exact real options - never pick one for them.`,
        },
      ];
    }

    return [
      { type: 'tool_call', tool: 'computer.openFile', args: { filePath: matches[0].path } },
      {
        type: 'llm_call',
        maxTokens: 200,
        instruction:
          `The previous step's result confirms a file was opened (or, if it failed - e.g. a blocked file type - ` +
          `an error explaining why). Tell the user plainly what happened, in one or two sentences.`,
      },
    ];
  }

  /**
   * Resolves an app NAME against the COMPUTER_ALLOWED_APPS allowlist -
   * deliberately NOT a filesystem search like planOpenFile. Being
   * launchable is a separate, narrower permission than being readable; an
   * app sitting inside an allowed root is never enough on its own - only a
   * name explicitly present in COMPUTER_ALLOWED_APPS can ever be launched.
   */
  planLaunchApp(appName) {
    const matches = findAppsByName(appName);

    if (matches.length === 0) {
      return [
        {
          type: 'llm_call',
          maxTokens: 200,
          instruction:
            `Tell the user, honestly and clearly, that no app matching "${appName}" is in their configured ` +
            `allowlist - it needs to be added to COMPUTER_ALLOWED_APPS in .env before this agent can launch it.`,
        },
      ];
    }

    if (matches.length > 1) {
      const list = matches.map((m) => m.name).join(', ');
      return [
        {
          type: 'llm_call',
          maxTokens: 250,
          instruction: `Multiple allowed apps matched "${appName}": ${list}. Ask the user which specific one they mean - never pick one for them.`,
        },
      ];
    }

    return [
      { type: 'tool_call', tool: 'computer.launchApp', args: { exePath: matches[0].path } },
      {
        type: 'llm_call',
        maxTokens: 200,
        instruction:
          `The previous step's result confirms whether "${matches[0].name}" was launched, or if it failed, why. ` +
          `Tell the user plainly what happened, in one or two sentences.`,
      },
    ];
  }
}

module.exports = ComputerOperatorAgent;