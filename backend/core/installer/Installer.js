const fs = require('fs');
const path = require('path');
const memory = require('../../memory');
const activityLog = require('../activityLog');
const { detectSource } = require('./SourceDetector');
const { Downloader } = require('./Downloader');
const { SignatureVerifier } = require('./SignatureVerifier');
const { Manifest } = require('./Manifest');
const { DependencyResolver, CircularDependencyError } = require('./DependencyResolver');
const { PermissionManager } = require('./PermissionManager');
const { Activator } = require('./Activator');
const { Registry, compareSemver } = require('./Registry');
const toolRegistry = require('../../tools/ToolRegistry');

const CORE_VERSION = '1.0.0';
const SKILLS_DIR = path.join(__dirname, '..', '..', 'skills');

class InstallError extends Error {}

/**
 * Installer - the single orchestrator for the whole pipeline. Every other
 * class in this folder does exactly one job; this is the only place that
 * knows the order they run in. Never contains business logic belonging to
 * the orchestrator/agents system - it only ever installs/activates code,
 * it doesn't decide what agents *do*.
 */
class Installer {
  constructor() {
    this.downloader = new Downloader();
    this.verifier = new SignatureVerifier();
    this.depResolver = new DependencyResolver();
    this.permissionManager = new PermissionManager();
    this.activator = new Activator();
    this.registry = new Registry();
  }

  /**
   * @param {string} sourceInput - anything SourceDetector understands
   * @param {object} options - { approvedPermissions: string[], chain: string[] (internal), isUpdate: boolean }
   */
  async install(sourceInput, options = {}) {
    const approvedPermissions = options.approvedPermissions || [];
    const chain = options.chain || [];
    let installedDir = null;
    let registeredSkillId = null;

    await activityLog.record('installer', 'install.started', sourceInput, {});

    try {
      const source = detectSource(sourceInput);

      await activityLog.record('installer', 'download.started', sourceInput, { sourceType: source.type });
      const packageDir =
        source.type === 'registry'
          ? await this.downloader.fetch(this.registry.resolveSource(source.id))
          : await this.downloader.fetch(source);
      await activityLog.record('installer', 'download.completed', sourceInput, { sourceType: source.type });

      const checksum = this.verifier.computeChecksum(packageDir);
      const signature = this.verifier.verifySignature();
      await activityLog.record('installer', 'verification.completed', sourceInput, { checksum, signed: signature.signed });

      const manifest = Manifest.load(packageDir);
      await activityLog.record('installer', 'manifest.loaded', manifest.id, { version: manifest.version });

      if (chain.includes(manifest.id)) {
        throw new CircularDependencyError(`Circular dependency detected: ${[...chain, manifest.id].join(' -> ')}`);
      }

      if (compareSemver(CORE_VERSION, manifest.minimumCoreVersion) < 0) {
        throw new InstallError(
          `${manifest.id} requires CodeCraft AI >= ${manifest.minimumCoreVersion}, running ${CORE_VERSION}`
        );
      }
      const existing = await memory.getSkill(manifest.id);
      if (existing && !options.isUpdate) {
        throw new InstallError(`Skill "${manifest.id}" is already installed (v${existing.version}). Use update instead.`);
      }

      const installedSkillIds = (await memory.listSkills()).map((s) => s.id);
      const toolNamespaces = [...new Set(toolRegistry.list().map((t) => t.split('.')[0]))];
      const { satisfied, missing } = this.depResolver.classify(manifest.dependencies, {
        installedSkillIds,
        toolNamespaces,
      });

      for (const dep of missing) {
        this.depResolver.checkCircular(dep, [...chain, manifest.id]);
        try {
          this.registry.getDetails(dep);
          await this.install(`registry:${dep}`, { approvedPermissions, chain: [...chain, manifest.id] });
          await activityLog.record('installer', 'dependency.installed', dep, { for: manifest.id });
        } catch (err) {
          throw new InstallError(`Missing dependency "${dep}" for ${manifest.id}, and it's not available: ${err.message}`);
        }
      }

      this.permissionManager.validate(manifest.permissions, approvedPermissions);
      await activityLog.record('installer', 'permissions.approved', manifest.id, { permissions: manifest.permissions });

      installedDir = path.join(SKILLS_DIR, manifest.id);
      this._copyDir(packageDir, installedDir);

      const skillRecord = {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        author: manifest.author,
        description: manifest.description,
        manifest,
        permissions: approvedPermissions.filter((p) => manifest.permissions.includes(p)),
        status: 'enabled',
        sourceType: source.type,
        sourceInput: sourceInput,
        sourcePath: installedDir,
        checksum,
        installedAt: new Date().toISOString(),
      };
      await memory.saveSkill(skillRecord);
      registeredSkillId = manifest.id;
      await activityLog.record('installer', 'skill.registered', manifest.id, { version: manifest.version });

      const entryPath = this.activator.resolveEntryPath(installedDir, manifest.entry);
      const activated = this.activator.activate(manifest.id, entryPath);
      await activityLog.record('installer', 'skill.activated', manifest.id, {
        toolsRegistered: activated.tools.length,
        agentRegistered: !!activated.agent,
      });

      await activityLog.record('installer', 'install.completed', manifest.id, {
        version: manifest.version,
        dependenciesSatisfied: satisfied.length,
      });

      return { skill: skillRecord, activated };
    } catch (err) {
      if (installedDir && fs.existsSync(installedDir)) {
        fs.rmSync(installedDir, { recursive: true, force: true });
      }
      if (registeredSkillId) {
        await memory.deleteSkill(registeredSkillId);
      }
      await activityLog.record('installer', 'install.failed', sourceInput, { error: err.message });
      throw err;
    }
  }

  _copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, entry.name);
      const d = path.join(dest, entry.name);
      if (entry.isDirectory()) this._copyDir(s, d);
      else fs.copyFileSync(s, d);
    }
  }
}

module.exports = { Installer, InstallError, CORE_VERSION, SKILLS_DIR };
