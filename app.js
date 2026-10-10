const MAX_LEVEL = 60;
const fallbackXp = { 1: 0 };
let xpTable = { ...fallbackXp };
let routeState = [];
let editingIndex = null;
let originalDungeon = null;
let isNewDungeon = false;
let draggedDungeonIndex = null;
let draggedQuest = null;
let draggedPoolDungeonIndex = null;
let draggedPoolQuest = null;
let dungeonCatalog = [];
let questCatalog = [];
let questCatalogById = new Map();

const $ = (selector) => document.querySelector(selector);
const startModeInput = $('#start-mode');
const startValueInput = $('#start-value');
const startValueLabel = $('#start-value-label');
const factionInput = $('#faction');
const factionStatus = $('#faction-status');
let lastStartMode = startModeInput.value;
const routeEditor = $('#route-editor');
const routeContent = $('#route-content');
const toggleRouteButton = $('#toggle-route-btn');
const routeOutput = $('#route-output');
const reasonsOutput = $('#reasons-output');
const dungeonPool = $('#dungeon-pool');
const questPool = $('#quest-pool');
const dungeonPoolPanel = $('.dungeon-source-panel');
const questPoolPanel = $('.quest-source-panel');
const dungeonPoolContent = $('#dungeon-pool-content');
const questPoolContent = $('#quest-pool-content');
const toggleDungeonsButton = $('#toggle-dungeons-btn');
const toggleQuestsButton = $('#toggle-quests-btn');
const dungeonSearch = $('#dungeon-search');
const questSearch = $('#quest-search');
const questTarget = $('#quest-target');
const importPoolFileInput = $('#import-pool-file');
const importExportStatus = $('#import-export-status');
const rxpExportStatus = $('#rxp-export-status');
const prereqStatus = $('#prereq-warnings');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[char]);
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function linkedName(name, url) {
  const label = escapeHtml(name);
  const safeUrl = normalizeUrl(url);
  return safeUrl ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
}

function normalizeQuestId(value) {
  const questId = Number(value);
  return Number.isSafeInteger(questId) && questId > 0 ? questId : null;
}

function questUrl(value) {
  const questId = normalizeQuestId(value);
  return questId ? `https://www.wowhead.com/forever/quest=${questId}` : '';
}

function questIdFromUrl(value) {
  const url = normalizeUrl(value);
  const match = url.match(/(?:quest=|\/quest=)(\d+)/i);
  return match ? normalizeQuestId(match[1]) : null;
}

function normalizeRange(value) {
  const match = String(value || '').replace(/[–—]/g, '-').match(/(\d+)\s*-\s*(\d+)/);
  if (match) return { min: Number(match[1]), max: Number(match[2]) };
  const level = Number(String(value || '').match(/\d+/)?.[0]) || 1;
  return { min: level, max: level };
}

function normalizeDependency(dependency) {
  const dungeonName = String(dependency?.dungeonName || '').trim();
  return dungeonName ? { dungeonName } : null;
}

function normalizeDependencies(dependencies) {
  return Array.isArray(dependencies) ? dependencies.map(normalizeDependency).filter(Boolean) : [];
}

const FACTIONS = ['Alliance', 'Horde', 'Both'];

function normalizeFaction(faction) {
  return FACTIONS.includes(faction) ? faction : 'Both';
}

function factionOptions(selectedFaction) {
  return FACTIONS.map((faction) => `<option value="${faction}"${faction === selectedFaction ? ' selected' : ''}>${faction}</option>`).join('');
}

function questsForFaction(quests, faction = factionInput.value) {
  const excludedFaction = faction === 'Horde' ? 'Alliance' : 'Horde';
  return quests.filter((quest) => quest.faction !== excludedFaction);
}

const QUEST_ACTIONS = ['Pickup', 'Do', 'Turnin'];

function normalizeActions(actions) {
  if (!Array.isArray(actions)) return [...QUEST_ACTIONS];
  return QUEST_ACTIONS.filter((action) => actions.includes(action));
}

function rewardedXp(quest) {
  return quest.actions.includes('Turnin') ? quest.xp : 0;
}

function normalizeQuest(quest) {
  return {
    ...quest,
    actions: normalizeActions(quest?.actions),
    requiresQuests: ForeverguideQuestPrereqs.idList(quest?.requiresQuests),
    name: String(quest?.name || 'New quest').trim() || 'New quest',
    questLevel: Math.max(1, Math.min(MAX_LEVEL, Number(quest?.questLevel) || 1)),
    xp: Math.max(0, Number(quest?.xp) || 0),
    faction: normalizeFaction(quest?.faction),
    questId: normalizeQuestId(quest?.questId),
  };
}

function enrichQuest(quest) {
  const source = questCatalogById.get(normalizeQuestId(quest?.questId));
  if (!source) return normalizeQuest(quest);
  return normalizeQuest({
    ...source,
    ...quest,
    name: quest?.name || source.name,
    questLevel: quest?.questLevel ?? source.questLevel,
    xp: quest?.xp ?? source.xp,
    faction: quest?.faction ?? source.faction,
    requiredLevel: quest?.requiredLevel ?? source.requiredLevel,
    requiredRaceMask: quest?.requiredRaceMask ?? source.requiredRaceMask,
    zoneId: quest?.zoneId ?? source.zoneId,
    zone: quest?.zone ?? source.zone,
    starters: quest?.starters ?? source.starters,
    turnIns: quest?.turnIns ?? source.turnIns,
    objectiveLocations: quest?.objectiveLocations ?? source.objectiveLocations,
    objectiveSteps: quest?.objectiveSteps ?? source.objectiveSteps,
    completionWaypoints: quest?.completionWaypoints ?? source.completionWaypoints,
    objectiveText: quest?.objectiveText ?? source.objectiveText,
  });
}

function normalizeDungeon(dungeon) {
  const range = normalizeRange(dungeon?.levelRange || `${dungeon?.minLevel || 1}-${dungeon?.maxLevel || 10}`);
  return {
    name: String(dungeon?.name || 'New Dungeon').trim() || 'New Dungeon',
    url: normalizeUrl(dungeon?.url),
    levelRange: `${range.min}-${range.max}`,
    minLevel: range.min,
    maxLevel: range.max,
    xpFromMonsters: Math.max(0, Number(dungeon?.xpFromMonsters) || 0),
    dependencies: normalizeDependencies(dungeon?.dependencies),
    quests: Array.isArray(dungeon?.quests) ? dungeon.quests.map(enrichQuest) : [],
  };
}

function dependencyOptions(currentDungeonIndex, selectedDependencies) {
  const selected = new Set(selectedDependencies.map((dependency) => dependency.dungeonName));
  return routeState.map((rawDungeon, dungeonIndex) => {
    if (dungeonIndex === currentDungeonIndex) return '';
    const dungeon = normalizeDungeon(rawDungeon);
    const selectedAttribute = selected.has(dungeon.name) ? ' selected' : '';
    return `<option value="${escapeHtml(dungeon.name)}"${selectedAttribute}>${escapeHtml(dungeon.name)}</option>`;
  }).join('');
}

function selectedDependencies(select) {
  return [...select.selectedOptions].map((option) => ({ dungeonName: option.value }));
}

function formatLocations(locations = []) {
  return locations.map((location) => {
    const entries = (location.zones || []).flatMap((zone) => (zone.coordinates || []).map((point) => {
      const coords = point.map((value) => Number(value).toFixed(1)).join(', ');
      return `${location.name} · ${zone.zone || `Zone ${zone.zoneId}`} (${coords})`;
    }));
    return entries.length ? entries.join(', ') : `${location.name} (coordinates unavailable)`;
  }).join('; ');
}

function formatWaypoints(locations = []) {
  return locations.flatMap((zone) => (zone.coordinates || []).map((point) =>
    `${zone.zone || `Zone ${zone.zoneId}`} (${point.map((value) => Number(value).toFixed(1)).join(', ')})`)).join('; ');
}

function currentPrereqWarnings() {
  const dungeons = routeState.map(normalizeDungeon).map((dungeon) => ({ ...dungeon, quests: questsForFaction(dungeon.quests) }));
  const routeNames = new Map(dungeons.flatMap((dungeon) => dungeon.quests.map((quest) => [quest.questId, quest.name])));
  return ForeverguideQuestPrereqs.analyze(dungeons, (id) => routeNames.get(id) || questCatalogById.get(id)?.name || '',
    (id, name) => `${linkedName(name, questUrl(id))}${id ? ` (${id})` : ''}`);
}

function questLocationDetails(quest) {
  const rows = [
    ['Start', formatLocations([...(quest.starters?.npcs || []), ...(quest.starters?.objects || [])])],
    ['Turn-in', formatLocations([...(quest.turnIns?.npcs || []), ...(quest.turnIns?.objects || [])])],
    ['Objectives', formatLocations(quest.objectiveLocations || [])],
    ['Completion', formatWaypoints(quest.completionWaypoints || [])],
  ].filter(([, value]) => value);
  const objectiveText = Array.isArray(quest.objectiveText) ? quest.objectiveText.filter(Boolean) : [];
  if (objectiveText.length) rows.push(['Quest text', objectiveText.join(' ')]);
  const { all, any } = ForeverguideQuestPrereqs.requirements(quest);
  const prereqName = (id) => questCatalogById.get(id)?.name || `Quest ${id}`;
  if (all.length) rows.push(['Requires', all.map(prereqName).join(', ')]);
  if (any.length) rows.push(['Requires one of', any.map(prereqName).join(', ')]);
  if (!rows.length) return '';
  return `<details class="quest-location-details"><summary>Locations and objectives</summary>${rows.map(([label, value]) => `<p><strong>${label}:</strong> ${escapeHtml(value)}</p>`).join('')}</details>`;
}

function progressAt(totalXp) {
  let level = 1;
  while (level < MAX_LEVEL && totalXp >= (xpTable[level + 1] ?? Infinity)) level += 1;
  const start = xpTable[level] ?? 0;
  const next = xpTable[level + 1] ?? start;
  const value = level + (next > start ? Math.max(0, totalXp - start) / (next - start) : 0);
  const displayValue = Number(value.toFixed(2));
  return { level, value, display: Number.isInteger(displayValue) ? String(displayValue) : String(displayValue) };
}

function startingExperience(mode = startModeInput.value, inputValue = startValueInput.value) {
  const maxXp = xpTable[MAX_LEVEL] || Number.MAX_SAFE_INTEGER;
  const value = Number(inputValue);
  if (!Number.isFinite(value)) return 0;
  if (mode === 'xp') return Math.max(0, Math.min(maxXp, value));
  const level = Math.max(1, Math.min(MAX_LEVEL, value));
  const wholeLevel = Math.floor(level);
  const fraction = level - wholeLevel;
  const startXp = xpTable[wholeLevel] ?? 0;
  const nextXp = xpTable[Math.min(MAX_LEVEL, wholeLevel + 1)] ?? startXp;
  return startXp + fraction * (nextXp - startXp);
}

function updateStartInput() {
  const isXp = startModeInput.value === 'xp';
  startValueLabel.textContent = isXp ? 'Current experience (total XP)' : 'Starting level';
  startValueInput.min = isXp ? '0' : '1';
  startValueInput.max = isXp ? String(xpTable[MAX_LEVEL] || '') : String(MAX_LEVEL);
  startValueInput.step = isXp ? '1' : '0.01';
  startValueInput.value = isXp ? String(Math.round(startingExperience())) : String(progressAt(startingExperience()).value);
}

function createQuest(name = 'New quest') {
  return { name, questLevel: 1, xp: 0, faction: 'Both', questId: null, actions: [...QUEST_ACTIONS] };
}

function createDungeon(index = routeState.length) {
  return normalizeDungeon({ name: `Dungeon ${index + 1}`, url: '', levelRange: `${Math.max(1, index + 1)}-${Math.max(10, index + 10)}`, quests: [createQuest()], xpFromMonsters: 0 });
}

function payloadFromState() {
  return {
    startMode: startModeInput.value,
    startValue: Number.isFinite(Number(startValueInput.value)) ? Number(startValueInput.value) : 1,
    startLevel: startModeInput.value === 'level' ? Number(startValueInput.value) || 1 : progressAt(startingExperience()).value,
    faction: factionInput.value,
    route: routeState.map(normalizeDungeon),
  };
}

function routeFromPayload(payload) {
  if (!payload || !Array.isArray(payload.route)) return null;
  if (payload.startMode === 'xp') {
    startModeInput.value = 'xp';
    startValueInput.value = String(Math.max(0, Number(payload.startValue) || 0));
  } else {
    startModeInput.value = 'level';
    startValueInput.value = String(Math.max(1, Math.min(MAX_LEVEL, Number(payload.startValue ?? payload.startLevel) || 1)));
  }
  factionInput.value = payload.faction === 'Horde' ? 'Horde' : 'Alliance';
  lastStartMode = startModeInput.value;
  updateStartInput();
  return payload.route.map((rawDungeon) => {
    const dungeon = normalizeDungeon(rawDungeon);
    const defaultDungeon = defaultRoute.find((candidate) => candidate.name === dungeon.name);
    const defaultFactions = new Map((defaultDungeon?.quests || []).map((quest) => [quest.name, quest.faction]));
    const defaultQuestIds = new Map((defaultDungeon?.quests || []).map((quest) => [quest.name, quest.questId]));
    return {
      ...dungeon,
      url: rawDungeon?.url === undefined ? normalizeUrl(defaultDungeon?.url) : dungeon.url,
      quests: dungeon.quests.map((quest, index) => {
        const savedFaction = rawDungeon?.quests?.[index]?.faction;
        const savedQuestId = rawDungeon?.quests?.[index]?.questId;
        const legacyQuestId = questIdFromUrl(rawDungeon?.quests?.[index]?.url);
        return {
          ...quest,
          faction: FACTIONS.includes(savedFaction) ? savedFaction : defaultFactions.get(quest.name) || quest.faction,
          questId: savedQuestId === undefined ? legacyQuestId || defaultQuestIds.get(quest.name) || quest.questId : quest.questId,
        };
      }),
    };
  });
}

function renderEditor() {
  const openQuestDetails = new Set([...routeEditor.querySelectorAll('.dungeon-card')]
    .filter((card) => card.querySelector('details')?.open)
    .map((card) => card.dataset.name));
  $('#route-count').textContent = `(${routeState.length})`;
  const warningKeys = new Set(currentPrereqWarnings().map((warning) => `${warning.dungeonName}|${warning.questId}`));
  routeEditor.innerHTML = routeState.length ? routeState.map((raw, index) => {
    const dungeon = normalizeDungeon(raw);
    if (editingIndex !== index) {
      const availableQuests = questsForFaction(dungeon.quests);
      const questXp = availableQuests.reduce((sum, quest) => sum + rewardedXp(quest), 0);
      const questLabel = `${availableQuests.length} of ${dungeon.quests.length} faction-eligible quests`;
      const upstreamNames = dungeon.dependencies.map((dependency) => dependency.dungeonName).join(', ');
      const downstreamNames = routeState.flatMap((candidate, candidateIndex) => candidateIndex !== index && normalizeDungeon(candidate).dependencies.some((dependency) => dependency.dungeonName === dungeon.name) ? [normalizeDungeon(candidate).name] : []).join(', ');
      const dependencyDetails = [
        upstreamNames && `<p><strong>Requires completion of:</strong> ${escapeHtml(upstreamNames)}</p>`,
        downstreamNames && `<p><strong>Completion unlocks:</strong> ${escapeHtml(downstreamNames)}</p>`,
      ].filter(Boolean).join('');
      return `<article class="dungeon-card" data-index="${index}" data-name="${escapeHtml(dungeon.name)}" draggable="${editingIndex === null}">
        <div class="dungeon-card-topline"><div><h3>${linkedName(dungeon.name, dungeon.url)}</h3>
          <p class="dungeon-card-meta">Levels ${escapeHtml(dungeon.levelRange)} · ${questLabel} · ${questXp.toLocaleString()} quest + ${dungeon.xpFromMonsters.toLocaleString()} monster XP</p></div>
          <div class="card-icon-actions"><button class="icon-button edit-dungeon-btn" data-index="${index}" aria-label="Edit ${escapeHtml(dungeon.name)}" title="Edit dungeon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16.5V20h3.5L18 9.5 14.5 6 4 16.5Zm16.7-10.8a1 1 0 0 0 0-1.4l-2-2a1 1 0 0 0-1.4 0l-1.7 1.7 3.4 3.4 1.7-1.7Z"/></svg></button>
          <button class="icon-button danger-icon delete-dungeon-btn" data-index="${index}" aria-label="Delete ${escapeHtml(dungeon.name)}" title="Delete dungeon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"/></svg></button></div></div>
        ${dependencyDetails ? `<div class="dungeon-card-dependencies">${dependencyDetails}</div>` : ''}
        <details class="card-quest-details"><summary>View quest details</summary><ul class="dungeon-card-quests">${dungeon.quests.map((quest, questIndex) => `<li data-quest-index="${questIndex}" data-quest-id="${quest.questId ?? ''}" draggable="${editingIndex === null}"><div>${linkedName(quest.name, questUrl(quest.questId))}${warningKeys.has(`${dungeon.name}|${quest.questId}`) ? ' <span class="prereq-flag" title="Missing prerequisite quests">⚠ missing prerequisite</span>' : ''} <span>${quest.faction} · Lvl ${quest.questLevel} · ${quest.xp.toLocaleString()} XP · ${quest.actions.join('/') || 'No actions'}</span>${questLocationDetails(quest)}</div><button class="icon-button danger-icon remove-route-quest-btn" data-dungeon-index="${index}" data-quest-index="${questIndex}" aria-label="Remove ${escapeHtml(quest.name)} from route" title="Remove quest from route"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"/></svg></button></li>`).join('')}</ul></details>
      </article>`;
    }
    return `<article class="dungeon-card is-editing" data-index="${index}" data-name="${escapeHtml(dungeon.name)}">
      <div class="dungeon-edit-heading"><h3>Edit dungeon</h3><button class="icon-button cancel-edit-btn" data-index="${index}" aria-label="Cancel editing" title="Cancel editing"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m19 6.4-1.4-1.4L12 10.6 6.4 5 5 6.4l5.6 5.6L5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4Z"/></svg></button></div>
      <div class="dungeon-header"><div class="field-group dungeon-name-field"><label>Dungeon name</label><input class="dungeon-name" value="${escapeHtml(dungeon.name)}" /></div>
        <div class="field-group dungeon-url-field"><label>Dungeon URL</label><input class="dungeon-url" type="url" value="${escapeHtml(dungeon.url)}" placeholder="https://" /></div>
        <div class="field-group dungeon-range-field"><label>Dungeon level range</label><input class="dungeon-range" value="${escapeHtml(dungeon.levelRange)}" /></div>
        <div class="field-group dungeon-monster-xp-field"><label>Experience from monsters</label><input class="dungeon-monster-xp" type="number" min="0" value="${dungeon.xpFromMonsters}" /></div>
        <div class="field-group dungeon-dependency-field"><label>Requires completion of</label><input class="dependency-search" type="search" placeholder="Search dungeon/step" aria-label="Search required dungeons" /><select class="dungeon-dependencies" multiple size="3" aria-label="Dungeons that must be completed first">${dependencyOptions(index, dungeon.dependencies)}</select></div>
        <div class="field-group dungeon-dependency-field"><label>Completion unlocks</label><input class="downstream-dependency-search" type="search" placeholder="Search dungeon/step" aria-label="Search unlocked dungeons" /><select class="dungeon-downstream-dependencies" multiple size="3" aria-label="Dungeons unlocked by completion">${dependencyOptions(index, routeState.flatMap((candidate, candidateIndex) => candidateIndex !== index && normalizeDungeon(candidate).dependencies.some((dependency) => dependency.dungeonName === dungeon.name) ? [{ dungeonName: normalizeDungeon(candidate).name }] : []))}</select></div></div>
      <div class="quest-list">${dungeon.quests.map((quest, questIndex) => `<div class="quest-row" data-quest-index="${questIndex}" draggable="true">
        <div class="field-group quest-field"><label>Quest</label><input class="quest-name" value="${escapeHtml(quest.name)}" /></div>
        <div class="field-group quest-id-field"><label>Quest ID</label><input class="quest-id" type="number" min="1" step="1" value="${quest.questId ?? ''}" placeholder="Quest ID" /></div>
        <div class="field-group quest-level-field"><label>Quest level</label><input class="quest-level" type="number" min="1" max="60" value="${quest.questLevel}" /></div>
        <div class="field-group quest-xp-field"><label>XP reward</label><input class="quest-xp" type="number" min="0" value="${quest.xp}" /></div>
        <div class="field-group quest-faction-field"><label>Faction</label><select class="quest-faction">${factionOptions(quest.faction)}</select></div>
        <div class="field-group quest-requires-field"><label>Also requires quest IDs</label><input class="quest-requires" value="${quest.requiresQuests.join(', ')}" placeholder="e.g. 96392" /></div>
        <div class="field-group quest-actions-field"><label>Actions</label><div class="quest-actions">${QUEST_ACTIONS.map((action) => `<label><input type="checkbox" class="quest-action" value="${action}"${quest.actions.includes(action) ? ' checked' : ''} /> ${action}</label>`).join('')}</div></div>
        <button class="icon-button danger-icon remove-quest-btn" data-quest-index="${questIndex}" aria-label="Remove quest" title="Remove quest"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"/></svg></button>
      </div>`).join('')}</div><div class="card-edit-actions"><button class="secondary-button add-quest-btn">Add quest</button><button class="save-dungeon-btn">Done</button></div></article>`;
  }).join('') : '<p class="empty-state route-drop-empty">Your route is empty. Drag a dungeon here to get started.</p>';
  routeEditor.querySelectorAll('.dungeon-card').forEach((card) => {
    const details = card.querySelector('details');
    if (details && openQuestDetails.has(card.dataset.name)) details.open = true;
  });
  const selectedTarget = routeState.some((dungeon) => normalizeDungeon(dungeon).name === questTarget.value) ? questTarget.value : '';
  questTarget.innerHTML = '<option value="">Choose a route dungeon</option>' + routeState.map((dungeon) => {
    const normalized = normalizeDungeon(dungeon);
    return `<option value="${escapeHtml(normalized.name)}">${escapeHtml(normalized.name)}</option>`;
  }).join('');
  questTarget.value = selectedTarget || routeState[0]?.name || '';
}

function setRouteExpanded(expanded) {
  routeContent.hidden = !expanded;
  routeContent.closest('.route-builder-panel').classList.toggle('is-collapsed', !expanded);
  toggleRouteButton.setAttribute('aria-expanded', String(expanded));
  toggleRouteButton.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} route builder`);
  toggleRouteButton.title = `${expanded ? 'Collapse' : 'Expand'} route builder`;
}

function setSourcePoolsExpanded(expanded) {
  setSourcePoolExpanded(dungeonPoolPanel, dungeonPoolContent, toggleDungeonsButton, expanded, 'Dungeons');
  setSourcePoolExpanded(questPoolPanel, questPoolContent, toggleQuestsButton, expanded, 'Quests');
}

function setSourcePoolExpanded(panel, content, button, expanded, name) {
  content.hidden = !expanded;
  panel.classList.toggle('is-collapsed', !expanded);
  button.setAttribute('aria-expanded', String(expanded));
  button.title = `${expanded ? 'Collapse' : 'Expand'} ${name}`;
}

function renderDungeonPool() {
  const query = dungeonSearch.value.trim().toLocaleLowerCase();
  const filtered = dungeonCatalog.filter((dungeon) => dungeon.name.toLocaleLowerCase().includes(query));
  $('#dungeon-pool-count').textContent = `(${filtered.length})`;
  dungeonPool.innerHTML = filtered.map((dungeon) => {
    const isAdded = routeState.some((routeDungeon) => normalizeDungeon(routeDungeon).name === dungeon.name);
    const index = dungeonCatalog.indexOf(dungeon);
    return `<article class="pool-item" draggable="${!isAdded}" data-pool-dungeon-index="${index}"><div><h3>${escapeHtml(dungeon.name)}</h3><p>Levels ${escapeHtml(dungeon.levelRange)} · ${dungeon.quests.length} quests</p></div><button class="secondary-button add-pool-dungeon-btn" data-index="${index}"${isAdded ? ' disabled' : ''}>${isAdded ? 'In route' : 'Add'}</button></article>`;
  }).join('') || '<p class="empty-state">No dungeons match that search.</p>';
}

function renderQuestPool() {
  const query = questSearch.value.trim().toLocaleLowerCase();
  const filtered = questsForFaction(questCatalog).filter((quest) =>
    !query || `${quest.name} ${quest.questId} ${quest.zone || ''}`.toLocaleLowerCase().includes(query));
  const visible = filtered.slice(0, 80);
  $('#quest-pool-count').textContent = `(${filtered.length.toLocaleString()})`;
  const remaining = filtered.length - visible.length;
  questPool.innerHTML = visible.map((quest) => `<article class="pool-item quest-pool-item" draggable="true" data-pool-quest-id="${quest.questId}">
    <div class="pool-item-copy"><h3>${linkedName(quest.name, questUrl(quest.questId))}</h3><p>#${quest.questId} · ${quest.zone || 'Zone unknown'} · Lvl ${quest.requiredLevel} req / ${quest.questLevel} quest · ${quest.xp.toLocaleString()} XP · ${quest.faction}</p>${questLocationDetails(quest)}</div>
    <button class="secondary-button add-pool-quest-btn" data-quest-id="${quest.questId}"${questTarget.value ? '' : ' disabled'}>Add</button>
  </article>`).join('') || '<p class="empty-state">No quests match that search.</p>';
  if (remaining > 0) questPool.insertAdjacentHTML('beforeend', `<p class="pool-limit-note">Showing ${visible.length} of ${filtered.length.toLocaleString()}. Refine your search to see more.</p>`);
}

function renderPools() {
  renderDungeonPool();
  renderQuestPool();
}

function addDungeonFromPool(index, insertAt = routeState.length) {
  const dungeon = dungeonCatalog[index];
  if (!dungeon || routeState.some((item) => normalizeDungeon(item).name === dungeon.name)) return;
  setRouteExpanded(true);
  routeState.splice(Math.max(0, Math.min(insertAt, routeState.length)), 0, structuredClone(normalizeDungeon(dungeon)));
  editingIndex = null;
  renderEditor();
  renderPools();
  runPlanner();
}

function addQuestFromPool(questId, dungeonName = questTarget.value) {
  const quest = questCatalog.find((item) => item.questId === Number(questId));
  const dungeonIndex = routeState.findIndex((item) => normalizeDungeon(item).name === dungeonName);
  if (!quest || dungeonIndex < 0) {
    importExportStatus.textContent = 'Add a dungeon to your route, then choose it as the quest destination.';
    return;
  }
  const dungeon = normalizeDungeon(routeState[dungeonIndex]);
  if (dungeon.quests.some((item) => item.questId === quest.questId)) return;
  setRouteExpanded(true);
  dungeon.quests.push(normalizeQuest(structuredClone(quest)));
  routeState[dungeonIndex] = dungeon;
  renderEditor();
  renderPools();
  runPlanner();
}

function syncEditingDungeon() {
  if (editingIndex === null) return;
  const card = routeEditor.querySelector(`.dungeon-card[data-index="${editingIndex}"]`);
  if (!card) return;
  const existingQuests = routeState[editingIndex].quests || [];
  routeState[editingIndex] = normalizeDungeon({
    name: card.querySelector('.dungeon-name').value,
    url: card.querySelector('.dungeon-url').value,
    levelRange: card.querySelector('.dungeon-range').value,
    xpFromMonsters: card.querySelector('.dungeon-monster-xp').value,
    dependencies: selectedDependencies(card.querySelector('.dungeon-dependencies')),
    quests: [...card.querySelectorAll('.quest-row')].map((row, questIndex) => ({
      ...existingQuests[questIndex],
      name: row.querySelector('.quest-name').value,
      questId: row.querySelector('.quest-id').value,
      questLevel: row.querySelector('.quest-level').value,
      xp: row.querySelector('.quest-xp').value,
      faction: row.querySelector('.quest-faction').value,
      actions: [...row.querySelectorAll('.quest-action:checked')].map((box) => box.value),
      requiresQuests: row.querySelector('.quest-requires').value.split(/[\s,]+/).filter(Boolean),
    })),
  });
  runPlanner();
}

function missingDependencies(dungeon, completedDungeons) {
  return dungeon.dependencies.filter((dependency) => !completedDungeons.has(dependency.dungeonName));
}

function getRoute(startXp, dungeons) {
  let totalXp = startXp;
  const maxXp = xpTable[MAX_LEVEL] || Number.MAX_SAFE_INTEGER;
  const sorted = dungeons.map(normalizeDungeon).sort((a, b) => a.minLevel - b.minLevel);
  const completedDungeons = new Set();
  const route = [];
  let madeProgress = true;
  while (madeProgress && totalXp < maxXp) {
    madeProgress = false;
    for (const dungeon of sorted) {
      if (totalXp >= maxXp) break;
      if (completedDungeons.has(dungeon.name) || missingDependencies(dungeon, completedDungeons).length) continue;
      const requiredLevel = Math.max(dungeon.minLevel, ...dungeon.quests.filter((quest) => quest.actions.includes('Pickup')).map((quest) => quest.questLevel));
      if (progressAt(totalXp).value < requiredLevel) continue;
      const start = progressAt(totalXp);
      const questXp = dungeon.quests.reduce((sum, quest) => sum + rewardedXp(quest), 0);
      const monsterXp = dungeon.xpFromMonsters;
      totalXp = Math.min(maxXp, totalXp + questXp + monsterXp);
      completedDungeons.add(dungeon.name);
      madeProgress = true;
      route.push({ dungeon, quests: dungeon.quests, questXp, monsterXp, totalXp, start: start.display, end: progressAt(totalXp).display });
    }
  }
  const progress = progressAt(totalXp);
  const pending = sorted.filter((dungeon) => !completedDungeons.has(dungeon.name));
  const next = pending[0];
  let endReason;
  if (totalXp >= maxXp) endReason = { title: 'Maximum level reached', message: `The route reached level ${MAX_LEVEL}. No more dungeon XP is needed for leveling.` };
  else if (!next) endReason = { title: 'Dungeon pool completed', message: 'Every dungeon in the pool was completed with all prerequisites met.' };
  else if (missingDependencies(next, completedDungeons).length) {
    const missing = missingDependencies(next, completedDungeons).map((dependency) => dependency.dungeonName).join(', ');
    endReason = { title: 'Dungeon prerequisite not completed', message: `${next.name} requires completion of ${missing} before it can be entered.` };
  }
  else if (progress.value < next.minLevel) {
    const needed = Math.max(0, (xpTable[next.minLevel] || totalXp) - totalXp);
    endReason = { title: 'Not high enough to enter the next dungeon', message: `The next dungeon is ${next.name} (minimum level ${next.minLevel}). You are level ${progress.display} and need ${needed.toLocaleString()} more XP to enter it.` };
  } else {
    const required = Math.max(next.minLevel, ...next.quests.filter((quest) => quest.actions.includes('Pickup')).map((quest) => quest.questLevel));
    const needed = Math.max(0, (xpTable[required] || totalXp) - totalXp);
    endReason = { title: 'Quest level requirement stopped the route', message: `You must be able to accept every quest in ${next.name}, including the level ${required} requirement. At level ${progress.display}, you need ${needed.toLocaleString()} more XP before entering.` };
  }
  return { route, endReason, finalProgress: progress, completedDungeonCount: completedDungeons.size };
}

function runPlanner() {
  const startXp = startingExperience();
  const startProgress = progressAt(startXp);
  const normalizedPool = routeState.map(normalizeDungeon);
  const factionCounts = normalizedPool.flatMap((dungeon) => dungeon.quests).reduce((counts, quest) => {
    counts[quest.faction] = (counts[quest.faction] || 0) + 1;
    return counts;
  }, { Alliance: 0, Horde: 0, Both: 0 });
  factionStatus.textContent = `Quests in route: ${factionCounts.Alliance} Alliance-only · ${factionCounts.Both} Both factions · ${factionCounts.Horde} Horde-only`;
  const eligiblePool = normalizedPool.map((dungeon) => ({ ...dungeon, quests: questsForFaction(dungeon.quests) }))
    .filter((dungeon) => dungeon.quests.length > 0 || dungeon.xpFromMonsters > 0);
  const result = getRoute(startXp, eligiblePool);
  const prereqWarnings = currentPrereqWarnings();
  prereqStatus.hidden = !prereqWarnings.length;
  prereqStatus.innerHTML = prereqWarnings.length
    ? `<strong>${prereqWarnings.length} quest${prereqWarnings.length === 1 ? '' : 's'} missing prerequisites:</strong><ul>${prereqWarnings.map((warning) => `<li><em>${escapeHtml(warning.dungeonName)}:</em> ${warning.message} <a href="#" class="prereq-jump" data-dungeon="${escapeHtml(warning.dungeonName)}" data-quest-id="${warning.questId ?? ''}">Go to quest</a></li>`).join('')}</ul>`
    : '';
  $('#summary-start-level').textContent = startProgress.display;
  const routeQuestCount = result.route.reduce((sum, step) => sum + step.quests.length, 0);
  $('#summary-route-length').textContent = `${result.completedDungeonCount} steps (${routeQuestCount} quests)`;
  $('#summary-final-level').textContent = result.finalProgress.display;
  routeOutput.innerHTML = result.route.length ? result.route.map((step, index) => `<article class="route-step"><h3>Step ${index + 1}: ${linkedName(step.dungeon.name, step.dungeon.url)}</h3><p><strong>Dungeon range:</strong> ${escapeHtml(step.dungeon.levelRange)}</p><p><strong>Earned:</strong> ${(step.questXp + step.monsterXp).toLocaleString()} XP (${step.questXp.toLocaleString()} from quests + ${step.monsterXp.toLocaleString()} from monsters)</p><p><strong>Level progression:</strong> started at level ${step.start} and ended at level ${step.end} (${step.totalXp.toLocaleString()} XP total)</p><ul>${step.quests.map((quest) => `<li>${linkedName(quest.name, questUrl(quest.questId))} — Level ${quest.questLevel} — ${quest.actions.join('/') || 'No actions'} — ${rewardedXp(quest).toLocaleString()} XP${questLocationDetails(quest)}</li>`).join('')}</ul></article>`).join('') : `<p class="empty-state">${eligiblePool.length ? 'No valid dungeon route was found for this starting level and route.' : 'Your route is empty. Add a dungeon from the pool to plan XP.'}</p>`;
  reasonsOutput.innerHTML = `<article class="reason-item route-ending-summary"><h3>${escapeHtml(result.endReason.title)}</h3><p>${escapeHtml(result.endReason.message)}</p></article>`;
}

function saveAndClose() {
  const card = routeEditor.querySelector(`.dungeon-card[data-index="${editingIndex}"]`);
  const downstreamNames = selectedDependencies(card.querySelector('.dungeon-downstream-dependencies')).map((dependency) => dependency.dungeonName);
  const previousName = originalDungeon?.name;
  syncEditingDungeon();
  const currentName = routeState[editingIndex].name;
  routeState.forEach((rawDungeon, index) => {
    if (index === editingIndex) return;
    const dungeon = normalizeDungeon(rawDungeon);
    const dependencies = dungeon.dependencies.map((dependency) => ({
      dungeonName: dependency.dungeonName === previousName ? currentName : dependency.dungeonName,
    })).filter((dependency) => dependency.dungeonName !== currentName);
    if (downstreamNames.includes(dungeon.name)) dependencies.push({ dungeonName: currentName });
    routeState[index] = { ...dungeon, dependencies };
  });
  editingIndex = null;
  originalDungeon = null;
  isNewDungeon = false;
  renderEditor();
  renderPools();
  runPlanner();
}

function addDungeonToPool() {
  setRouteExpanded(true);
  routeState.push(createDungeon());
  editingIndex = routeState.length - 1;
  originalDungeon = null;
  isNewDungeon = true;
  renderEditor();
  const editCard = routeEditor.querySelector('.dungeon-card.is-editing');
  editCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  editCard?.querySelector('.dungeon-name')?.focus({ preventScroll: true });
  renderPools();
  runPlanner();
}

function exportPoolJson() {
  return JSON.stringify(payloadFromState(), null, 2);
}

function exportPool() {
  const blob = new Blob([exportPoolJson()], { type: 'application/json' });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = 'foreverguide-route.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
  importExportStatus.textContent = '';
}

function exportRestedXPGuide() {
  try {
    const route = routeState.map(normalizeDungeon);
    const startingLevel = progressAt(startingExperience()).display;
    const archive = ForeverguideRXPExport.createAddonArchive(route, factionInput.value, startingLevel);
    const blob = new Blob([archive.bytes], { type: 'application/zip' });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = archive.filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
    rxpExportStatus.textContent = '';
  } catch (error) {
    rxpExportStatus.textContent = error.message;
  }
}

function importPoolJson(jsonText) {
  const payload = JSON.parse(jsonText);
  const importedRoute = routeFromPayload(payload);
  if (!importedRoute) throw new Error('The JSON file must contain a route array.');
  routeState = importedRoute;
  editingIndex = null;
  originalDungeon = null;
  isNewDungeon = false;
  setRouteExpanded(true);
  renderEditor();
  renderPools();
  runPlanner();
  importExportStatus.textContent = `Imported route with ${routeState.length} dungeons.`;
}

function importPoolFile() {
  const file = importPoolFileInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    try {
      importPoolJson(String(reader.result));
    } catch (error) {
      importExportStatus.textContent = `Import failed: ${error.message}`;
    }
    importPoolFileInput.value = '';
  });
  reader.addEventListener('error', () => {
    importExportStatus.textContent = 'Import failed: Could not read the selected file.';
    importPoolFileInput.value = '';
  });
  reader.readAsText(file);
}

routeEditor.addEventListener('input', (event) => {
  if (event.target.matches('.dependency-search, .downstream-dependency-search')) {
    const search = event.target.value.trim().toLocaleLowerCase();
    const select = event.target.parentElement.querySelector(event.target.classList.contains('dependency-search') ? '.dungeon-dependencies' : '.dungeon-downstream-dependencies');
    for (const option of select.options) option.hidden = !option.textContent.toLocaleLowerCase().includes(search);
  } else if (event.target.matches('.dungeon-name, .dungeon-url, .dungeon-range, .dungeon-monster-xp, .quest-name, .quest-id, .quest-level, .quest-xp, .quest-requires')) syncEditingDungeon();
});
routeEditor.addEventListener('change', (event) => {
  if (event.target.matches('.dungeon-dependencies, .dungeon-downstream-dependencies, .quest-faction, .quest-action')) syncEditingDungeon();
});
dungeonPool.addEventListener('click', (event) => {
  const button = event.target.closest('.add-pool-dungeon-btn');
  if (button) addDungeonFromPool(Number(button.dataset.index));
});
prereqStatus.addEventListener('click', (event) => {
  const link = event.target.closest('.prereq-jump');
  if (!link) return;
  event.preventDefault();
  setRouteExpanded(true);
  const card = [...routeEditor.querySelectorAll('.dungeon-card')].find((candidate) => candidate.dataset.name === link.dataset.dungeon);
  const details = card?.querySelector('details');
  if (!details) return;
  details.open = true;
  const item = [...details.querySelectorAll('li')].find((candidate) => candidate.dataset.questId === link.dataset.questId);
  (item || card).scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (!item) return;
  item.classList.add('is-prereq-target');
  setTimeout(() => item.classList.remove('is-prereq-target'), 2500);
});

questPool.addEventListener('click', (event) => {
  const button = event.target.closest('.add-pool-quest-btn');
  if (button) addQuestFromPool(button.dataset.questId);
});
dungeonSearch.addEventListener('input', renderDungeonPool);
questSearch.addEventListener('input', renderQuestPool);
questTarget.addEventListener('change', renderQuestPool);
dungeonPool.addEventListener('dragstart', (event) => {
  const item = event.target.closest('.pool-item[draggable="true"]');
  if (!item || event.target.closest('button, a, summary')) { event.preventDefault(); return; }
  draggedPoolDungeonIndex = Number(item.dataset.poolDungeonIndex);
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('text/plain', `pool-dungeon:${draggedPoolDungeonIndex}`);
});
questPool.addEventListener('dragstart', (event) => {
  const item = event.target.closest('.quest-pool-item');
  if (!item || event.target.closest('button, a, summary')) { event.preventDefault(); return; }
  draggedPoolQuest = Number(item.dataset.poolQuestId);
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('text/plain', `pool-quest:${draggedPoolQuest}`);
});
for (const pool of [dungeonPool, questPool]) pool.addEventListener('dragend', () => {
  draggedPoolDungeonIndex = null;
  draggedPoolQuest = null;
  routeEditor.querySelectorAll('.dungeon-card.is-drop-target').forEach((card) => card.classList.remove('is-drop-target'));
});
routeEditor.addEventListener('dragstart', (event) => {
  const editQuestRow = event.target.closest('.quest-row');
  if (editQuestRow) {
    const card = editQuestRow.closest('.dungeon-card.is-editing');
    if (!card || editingIndex === null) {
      event.preventDefault();
      return;
    }
    syncEditingDungeon();
    draggedQuest = {
      dungeonIndex: Number(card.dataset.index),
      questIndex: Number(editQuestRow.dataset.questIndex),
      isEditing: true,
    };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `edit-quest:${draggedQuest.dungeonIndex}:${draggedQuest.questIndex}`);
    editQuestRow.classList.add('is-quest-dragging');
    return;
  }
  const questItem = event.target.closest('.dungeon-card-quests li');
  if (questItem) {
    const card = questItem.closest('.dungeon-card:not(.is-editing)');
    if (!card || editingIndex !== null) {
      event.preventDefault();
      return;
    }
    draggedQuest = { dungeonIndex: Number(card.dataset.index), questIndex: Number(questItem.dataset.questIndex) };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `quest:${draggedQuest.dungeonIndex}:${draggedQuest.questIndex}`);
    questItem.classList.add('is-quest-dragging');
    return;
  }
  const card = event.target.closest('.dungeon-card:not(.is-editing)');
  if (!card || editingIndex !== null) {
    event.preventDefault();
    return;
  }
  draggedDungeonIndex = Number(card.dataset.index);
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', String(draggedDungeonIndex));
  card.classList.add('is-dragging');
});
routeEditor.addEventListener('dragover', (event) => {
  if (draggedPoolDungeonIndex !== null || draggedPoolQuest !== null) {
    const card = event.target.closest('.dungeon-card:not(.is-editing)');
    if (draggedPoolQuest !== null && !card) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    routeEditor.querySelectorAll('.dungeon-card.is-drop-target').forEach((target) => target.classList.remove('is-drop-target'));
    card?.classList.add('is-drop-target');
    return;
  }
  if (draggedQuest?.isEditing) {
    const row = event.target.closest('.quest-row');
    const card = row?.closest('.dungeon-card.is-editing');
    if (!row || Number(card.dataset.index) !== draggedQuest.dungeonIndex) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    routeEditor.querySelectorAll('.quest-row.is-quest-drop-target')
      .forEach((target) => target.classList.remove('is-quest-drop-target'));
    row.classList.add('is-quest-drop-target');
    return;
  }
  const card = event.target.closest('.dungeon-card:not(.is-editing)');
  if (!card) return;
  if (draggedQuest) {
    if (editingIndex !== null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    routeEditor.querySelectorAll('.dungeon-card.is-drop-target, .dungeon-card-quests li.is-quest-drop-target')
      .forEach((target) => target.classList.remove('is-drop-target', 'is-quest-drop-target'));
    const targetQuest = event.target.closest('.dungeon-card-quests li');
    (targetQuest || card).classList.add(targetQuest ? 'is-quest-drop-target' : 'is-drop-target');
    return;
  }
  if (draggedDungeonIndex === null) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  routeEditor.querySelectorAll('.dungeon-card.is-drop-target').forEach((target) => target.classList.remove('is-drop-target'));
  card.classList.add('is-drop-target');
});
routeEditor.addEventListener('drop', (event) => {
  if (draggedPoolDungeonIndex !== null) {
    event.preventDefault();
    const card = event.target.closest('.dungeon-card:not(.is-editing)');
    const targetIndex = card ? Number(card.dataset.index) : routeState.length;
    const sourceIndex = draggedPoolDungeonIndex;
    draggedPoolDungeonIndex = null;
    addDungeonFromPool(sourceIndex, targetIndex);
    return;
  }
  if (draggedPoolQuest !== null) {
    const card = event.target.closest('.dungeon-card:not(.is-editing)');
    if (!card) return;
    event.preventDefault();
    const questId = draggedPoolQuest;
    draggedPoolQuest = null;
    addQuestFromPool(questId, routeState[Number(card.dataset.index)].name);
    return;
  }
  if (draggedQuest?.isEditing) {
    const targetRow = event.target.closest('.quest-row');
    const card = targetRow?.closest('.dungeon-card.is-editing');
    if (!targetRow || Number(card.dataset.index) !== draggedQuest.dungeonIndex) return;
    event.preventDefault();
    const sourceIndex = draggedQuest.dungeonIndex;
    const sourceQuestIndex = draggedQuest.questIndex;
    const targetQuestIndex = Number(targetRow.dataset.questIndex);
    const targetRect = targetRow.getBoundingClientRect();
    const insertAfter = event.clientY > targetRect.top + targetRect.height / 2;
    let insertionIndex = targetQuestIndex + Number(insertAfter);
    if (sourceQuestIndex < insertionIndex) insertionIndex -= 1;
    const [quest] = routeState[sourceIndex].quests.splice(sourceQuestIndex, 1);
    insertionIndex = Math.max(0, Math.min(insertionIndex, routeState[sourceIndex].quests.length));
    routeState[sourceIndex].quests.splice(insertionIndex, 0, quest);
    draggedQuest = null;
    renderEditor();
    runPlanner();
    return;
  }
  const card = event.target.closest('.dungeon-card:not(.is-editing)');
  if (!card || editingIndex !== null) return;
  if (draggedQuest) {
    event.preventDefault();
    const sourceIndex = draggedQuest.dungeonIndex;
    const sourceQuestIndex = draggedQuest.questIndex;
    const targetIndex = Number(card.dataset.index);
    const targetQuest = event.target.closest('.dungeon-card-quests li');
    const targetQuestIndex = targetQuest ? Number(targetQuest.dataset.questIndex) : routeState[targetIndex].quests.length;
    const targetRect = targetQuest?.getBoundingClientRect();
    const insertAfter = targetRect ? event.clientY > targetRect.top + targetRect.height / 2 : false;
    let insertionIndex = targetQuestIndex + Number(insertAfter);
    if (sourceIndex === targetIndex && sourceQuestIndex < insertionIndex) insertionIndex -= 1;
    const [quest] = routeState[sourceIndex].quests.splice(sourceQuestIndex, 1);
    insertionIndex = Math.max(0, Math.min(insertionIndex, routeState[targetIndex].quests.length));
    routeState[targetIndex].quests.splice(insertionIndex, 0, quest);
    draggedQuest = null;
    renderEditor();
    runPlanner();
    return;
  }
  if (draggedDungeonIndex === null) return;
  event.preventDefault();
  const targetIndex = Number(card.dataset.index);
  const [dungeon] = routeState.splice(draggedDungeonIndex, 1);
  routeState.splice(targetIndex, 0, dungeon);
  draggedDungeonIndex = null;
  renderEditor();
  runPlanner();
});
routeEditor.addEventListener('dragend', () => {
  draggedDungeonIndex = null;
  draggedQuest = null;
  routeEditor.querySelectorAll('.dungeon-card.is-dragging, .dungeon-card.is-drop-target')
    .forEach((card) => card.classList.remove('is-dragging', 'is-drop-target'));
  routeEditor.querySelectorAll('.dungeon-card-quests li.is-quest-dragging, .dungeon-card-quests li.is-quest-drop-target')
    .forEach((quest) => quest.classList.remove('is-quest-dragging', 'is-quest-drop-target'));
  routeEditor.querySelectorAll('.quest-row.is-quest-dragging, .quest-row.is-quest-drop-target')
    .forEach((row) => row.classList.remove('is-quest-dragging', 'is-quest-drop-target'));
});
routeEditor.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const index = Number(button.dataset.index ?? editingIndex);
  if (button.classList.contains('edit-dungeon-btn')) {
    editingIndex = index;
    originalDungeon = structuredClone(routeState[index]);
    isNewDungeon = false;
    renderEditor();
  } else if (button.classList.contains('delete-dungeon-btn')) {
    const deletedName = normalizeDungeon(routeState[index]).name;
    routeState.splice(index, 1);
    routeState = routeState.map((rawDungeon) => ({
      ...normalizeDungeon(rawDungeon),
      dependencies: normalizeDungeon(rawDungeon).dependencies.filter((dependency) => dependency.dungeonName !== deletedName),
    }));
    if (editingIndex === index) { editingIndex = null; originalDungeon = null; isNewDungeon = false; }
    renderEditor(); renderPools(); runPlanner();
  } else if (button.classList.contains('remove-route-quest-btn')) {
    const dungeonIndex = Number(button.dataset.dungeonIndex);
    routeState[dungeonIndex].quests.splice(Number(button.dataset.questIndex), 1);
    renderEditor(); renderPools(); runPlanner();
  } else if (button.classList.contains('cancel-edit-btn')) {
    if (isNewDungeon) routeState.splice(index, 1);
    else if (originalDungeon) routeState[index] = originalDungeon;
    editingIndex = null; originalDungeon = null; isNewDungeon = false;
    renderEditor(); renderPools(); runPlanner();
  } else if (button.classList.contains('add-quest-btn')) {
    syncEditingDungeon(); routeState[editingIndex].quests.push(createQuest(`New quest ${routeState[editingIndex].quests.length + 1}`)); renderEditor();
  } else if (button.classList.contains('remove-quest-btn')) {
    syncEditingDungeon(); routeState[editingIndex].quests.splice(Number(button.dataset.questIndex), 1); renderEditor();
  } else if (button.classList.contains('save-dungeon-btn')) saveAndClose();
});

$('#calculate-btn').addEventListener('click', () => {
  runPlanner();
  setRouteExpanded(false);
  setSourcePoolsExpanded(false);
  $('#summary-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
toggleRouteButton.addEventListener('click', () => {
  setRouteExpanded(toggleRouteButton.getAttribute('aria-expanded') !== 'true');
});
toggleDungeonsButton.addEventListener('click', () => {
  setSourcePoolExpanded(dungeonPoolPanel, dungeonPoolContent, toggleDungeonsButton,
    toggleDungeonsButton.getAttribute('aria-expanded') !== 'true', 'Dungeons');
});
toggleQuestsButton.addEventListener('click', () => {
  setSourcePoolExpanded(questPoolPanel, questPoolContent, toggleQuestsButton,
    toggleQuestsButton.getAttribute('aria-expanded') !== 'true', 'Quests');
});
$('#add-dungeon-btn').addEventListener('click', addDungeonToPool);
$('#export-pool-btn').addEventListener('click', exportPool);
$('#export-rxp-btn').addEventListener('click', exportRestedXPGuide);
$('#import-pool-btn').addEventListener('click', () => importPoolFileInput.click());
importPoolFileInput.addEventListener('change', importPoolFile);
$('#reset-route-btn').addEventListener('click', () => {
  if (!window.confirm('Clear every dungeon and quest from the route? This cannot be undone.')) return;
  routeState = []; editingIndex = null; originalDungeon = null; isNewDungeon = false;
  renderEditor(); renderPools(); runPlanner();
});
startModeInput.addEventListener('change', () => {
  const experience = startingExperience(lastStartMode);
  const nextMode = startModeInput.value;
  startValueInput.value = nextMode === 'xp' ? String(Math.round(experience)) : String(progressAt(experience).value);
  lastStartMode = nextMode;
  updateStartInput();
  runPlanner();
});
factionInput.addEventListener('change', () => {
  renderEditor();
  renderPools();
  runPlanner();
});
startValueInput.addEventListener('input', runPlanner);
startValueInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') $('#calculate-btn').click(); });

const defaultRoute = [];
Promise.all([
  fetch('./xp_per_level.json').then((response) => response.ok ? response.json() : null).catch(() => null),
  fetch('./dungeon_quest_db.json').then((response) => response.ok ? response.json() : []).catch(() => []),
  fetch('./quest_catalog.json').then((response) => response.ok ? response.json() : null).catch(() => null),
]).then(([xpData, dungeonData, questData]) => {
  if (Array.isArray(xpData?.levels)) {
    for (const row of xpData.levels) {
      if (Number.isFinite(Number(row.level)) && Number.isFinite(Number(row.totalXp))) xpTable[Number(row.level)] = Number(row.totalXp);
    }
  }
  questCatalog = (Array.isArray(questData?.quests) ? questData.quests : []).map(normalizeQuest)
    .sort((left, right) => left.name.localeCompare(right.name));
  questCatalogById = new Map(questCatalog.map((quest) => [quest.questId, quest]));
  defaultRoute.splice(0, defaultRoute.length, ...(Array.isArray(dungeonData) ? dungeonData.map(normalizeDungeon) : []));
  dungeonCatalog = structuredClone(defaultRoute);
  updateStartInput();
  routeState = [];
  renderEditor();
  renderPools();
  runPlanner();
});
