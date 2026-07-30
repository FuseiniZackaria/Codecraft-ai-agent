const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const memory = require('../../memory');
const activityLog = require('../activityLog');
const { Activator } = require('./Activator');
const { Installer, SKILLS_DIR } = require('./Installer');
const { SignatureVerifier } = require('./SignatureVerifier');
const { Registry, compareSemver } = require('./Registry');

const BACKUPS_DIR = path.join(SKILLS_DIR, '..', '.skill-backups');

class SkillNotFoundError extends Error {}

/**
 * SkillManager - everything you do with a skill AFTER it's installed.
 * Installer owns the install pipeline; this owns the rest of the lifecycle.
 */
class SkillManager {
  constructor() {
    this.activator = new Activator();
    this.installer = new Installer();
    this.verifier = new SignatureVerifier();
    this.registry = new Registry();
  }

  async list() {
    return memory.listSkills();
  }

  async search(query) {
    const all = await memory.listSkills();
    const q = query.toLowerCase();
    return all.filter((s) => s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q));
  }

  async info(id) {
    const skill = await memory.getSkill(id);
    if (!skill) throw new SkillNotFoundError(`Skill "${id}" is not installed`);
    return skill;
  }

  async enable(id) {
    const skill = await this.info(id);
    const entryPath = this.activator.resolveEntryPath(skill.sourcePath, skill.manifest.entry);
    const activated = this.activator.activate(id, entryPath);
    const updated = await memory.updateSkill(id, { status: 'enabled' });
    await activityLog.record('skill-manager', 'skill.enabled', id, { toolsRegistered: activated.tools.length });
    return updated;
  }

  async disable(id) {
    await this.info(id);
    this.activator.deactivate(id);
    const updated = await memory.updateSkill(id, { status: 'disabled' });
    await activityLog.record('skill-manager', 'skill.disabled', id, {});
    return updated;
  }

  async remove(id) {
    const skill = await this.info(id);
    this.activator.deactivate(id);
    if (fs.existsSync(skill.sourcePath)) {
      fs.rmSync(skill.sourcePath, { recursive: true, force: true });
    }
    await memory.deleteSkill(id);
    await activityLog.record('skill-manager', 'skill.removed', id, {});
    return { removed: true, id };
  }

  async reinstall(id, approvedPermissions = []) {
    const skill = await this.info(id);
    await this.remove(id);
    return this.installer.install(skill.sourceInput, { approvedPermissions, isUpdate: false });
  }

  async repair(id) {
    const skill = await this.info(id);
    const currentChecksum = this.verifier.computeChecksum(skill.sourcePath);
    const corrupted = currentChecksum !== skill.checksum;

    let activationOk = true;
    try {
      const entryPath = this.activator.resolveEntryPath(skill.sourcePath, skill.manifest.entry);
      this.activator.activate(id, entryPath);
    } catch {
      activationOk = false;
    }

    if (!corrupted && activationOk) {
      await activityLog.record('skill-manager', 'skill.repair_not_needed', id, {});
      return { repaired: false, reason: 'no corruption detected' };
    }

    await activityLog.record('skill-manager', 'skill.repairing', id, { corrupted, activationOk });
    await this.reinstall(id, skill.permissions);
    return { repaired: true, corrupted, activationOk };
  }

  async checkForUpdate(id) {
    const skill = await this.info(id);
    if (skill.sourceType !== 'registry') {
      return { updateAvailable: false, reason: 'not a registry-sourced skill - no version source to check' };
    }
    const registryId = skill.sourceInput.replace(/^registry:/, '');
    const latest = this.registry.getLatestVersion(registryId);
    return { updateAvailable: compareSemver(latest, skill.version) > 0, current: skill.version, latest };
  }

  async update(id, newlyApprovedPermissions = []) {
    const skill = await this.info(id);
    const { updateAvailable, latest } = await this.checkForUpdate(id);
    if (!updateAvailable) return { updated: false, reason: 'already up to date' };

    const combinedPermissions = [...new Set([...skill.permissions, ...newlyApprovedPermissions])];
    await this.remove(id);
    const result = await this.installer.install(skill.sourceInput, {
      approvedPermissions: combinedPermissions,
      isUpdate: true,
    });
    await activityLog.record('skill-manager', 'update.completed', id, { from: skill.version, to: latest });
    return { updated: true, from: skill.version, to: latest, result };
  }

  async backup(id) {
    const skill = await this.info(id);
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    const backupPath = path.join(BACKUPS_DIR, `${id}-${skill.version}-${Date.now()}.zip`);
    const zip = new AdmZip();
    zip.addLocalFolder(skill.sourcePath);
    zip.writeZip(backupPath);
    await activityLog.record('skill-manager', 'skill.backed_up', id, { backupPath });
    return { backupPath };
  }

  async restore(id, backupPath) {
    if (!fs.existsSync(backupPath)) throw new Error(`Backup not found: ${backupPath}`);
    const skill = await this.info(id);
    this.activator.deactivate(id);
    fs.rmSync(skill.sourcePath, { recursive: true, force: true });
    const zip = new AdmZip(backupPath);
    zip.extractAllTo(skill.sourcePath, true);
    const entryPath = this.activator.resolveEntryPath(skill.sourcePath, skill.manifest.entry);
    this.activator.activate(id, entryPath);
    await activityLog.record('skill-manager', 'skill.restored', id, { backupPath });
    return { restored: true };
  }

  async exportSkill(id, destZipPath) {
    const skill = await this.info(id);
    const zip = new AdmZip();
    zip.addLocalFolder(skill.sourcePath);
    zip.writeZip(destZipPath);
    return { exportedTo: destZipPath };
  }

  async importSkill(zipPath, approvedPermissions = []) {
    return this.installer.install(zipPath, { approvedPermissions });
  }
}

module.exports = { SkillManager, SkillNotFoundError };
