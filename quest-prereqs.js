(function (global) {
  const validId = (value) => (Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null);
  const idList = (values) => [...new Set((Array.isArray(values) ? values : []).map(validId).filter(Boolean))];

  // all: every quest must be turned in; any: at least one must be (when non-empty).
  function requirements(quest) {
    return {
      all: idList([...(quest.preQuestGroup || []), ...(quest.requiresQuests || [])]).filter((id) => id !== validId(quest.questId)),
      any: idList(quest.preQuestSingle).filter((id) => id !== validId(quest.questId)),
    };
  }

  const hasTurnin = (quest) => !Array.isArray(quest.actions) || quest.actions.includes('Turnin');

  // Orders a dungeon's quests into layers so a prerequisite is turned in before its dependents start.
  function layerQuests(quests, turnedIn = new Set()) {
    const dungeonTurnins = new Set(quests.filter((quest) => validId(quest.questId) && hasTurnin(quest)).map((quest) => validId(quest.questId)));
    const placed = new Set();
    const layers = [];
    let remaining = [...quests];
    const ready = (quest) => {
      const { all, any } = requirements(quest);
      if (!all.every((id) => turnedIn.has(id) || placed.has(id) || !dungeonTurnins.has(id))) return false;
      const pending = any.filter((id) => dungeonTurnins.has(id));
      return !pending.length || any.some((id) => turnedIn.has(id)) || pending.some((id) => placed.has(id));
    };
    while (remaining.length) {
      const layer = remaining.filter(ready);
      if (!layer.length) { layers.push(remaining); break; }
      layers.push(layer);
      for (const quest of layer) if (validId(quest.questId) && hasTurnin(quest)) placed.add(validId(quest.questId));
      remaining = remaining.filter((quest) => !layer.includes(quest));
    }
    return layers;
  }

  // Walks the route in order and reports quests whose prerequisites are not turned in beforehand.
  function analyze(dungeons, nameFor = () => '', formatQuest = (id, name) => `"${name}" (${id})`) {
    const routeIds = new Set(dungeons.flatMap((dungeon) => dungeon.quests.map((quest) => validId(quest.questId))).filter(Boolean));
    const turnedIn = new Set();
    const warnings = [];
    const label = (id) => formatQuest(id, nameFor(id) || `Quest ${id}`);
    const describe = (ids) => ids.map((id) => `${label(id)} — ${routeIds.has(id) ? 'in the route but not turned in before this point' : 'not in the route'}`);
    for (const dungeon of dungeons) {
      for (const layer of layerQuests(dungeon.quests, turnedIn)) {
        for (const quest of layer) {
          const { all, any } = requirements(quest);
          const problems = [];
          const missingAll = all.filter((id) => !turnedIn.has(id));
          if (missingAll.length) problems.push(`requires ${describe(missingAll).join(', ')}`);
          if (any.length && !any.some((id) => turnedIn.has(id))) problems.push(`requires one of ${describe(any).join(', ')}`);
          if (problems.length) {
            warnings.push({ dungeonName: dungeon.name, questId: validId(quest.questId), questName: quest.name, message: `${formatQuest(validId(quest.questId), quest.name)} ${problems.join(' and ')}.` });
          }
        }
        for (const quest of layer) if (validId(quest.questId) && hasTurnin(quest)) turnedIn.add(validId(quest.questId));
      }
    }
    return warnings;
  }

  global.ForeverguideQuestPrereqs = { requirements, layerQuests, analyze, idList };
}(typeof window === 'undefined' ? globalThis : window));
