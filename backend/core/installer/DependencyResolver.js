const CORE_CAPABILITIES = ['memory', 'database', 'search', 'browser', 'llm'];

class CircularDependencyError extends Error {}

/**
 * DependencyResolver - single responsibility: given a manifest's declared
 * dependencies and the current system state (installed skills + registered
 * tool namespaces), classify each dependency as satisfied or missing, and
 * detect circular dependency chains during recursive resolution.
 */
class DependencyResolver {
  /**
   * @param {string[]} dependencies - manifest.dependencies
   * @param {{installedSkillIds: string[], toolNamespaces: string[]}} state
   */
  classify(dependencies, state) {
    const satisfied = [];
    const missing = [];

    for (const dep of dependencies) {
      const normalized = dep.toLowerCase();
      const isCore = CORE_CAPABILITIES.includes(normalized);
      const isInstalledSkill = state.installedSkillIds.includes(normalized);
      const isToolNamespace = state.toolNamespaces.includes(normalized);

      if (isCore || isInstalledSkill || isToolNamespace) {
        satisfied.push({ dependency: dep, via: isCore ? 'core' : isInstalledSkill ? 'skill' : 'tool' });
      } else {
        missing.push(dep);
      }
    }

    return { satisfied, missing };
  }

  /**
   * Call before recursively auto-installing a missing dependency. `chain` is
   * the list of skill ids currently being installed in this resolution.
   */
  checkCircular(dependencyId, chain) {
    if (chain.includes(dependencyId)) {
      throw new CircularDependencyError(
        `Circular dependency detected: ${[...chain, dependencyId].join(' -> ')}`
      );
    }
  }
}

module.exports = { DependencyResolver, CircularDependencyError, CORE_CAPABILITIES };
