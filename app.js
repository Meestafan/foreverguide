const MAX_LEVEL = 60;
const fallbackXp = { 1: 0 };
let xpTable = { ...fallbackXp };
let routeState = [];
let editingIndex = null;
let originalDungeon = null;
let isNewDungeon = false;
let draggedDungeonIndex = null;
let draggedQuest = null;
let dungeonCatalog = [];
let questCatalog = [];
let questCatalogById = new Map();
let questFollowups = new Map();

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
const duplicateStatus = $('#duplicate-warnings');
const editModal = $('#edit-modal');
const editForm = $('#edit-modal-form');
const modalQuestPool = $('#modal-quest-pool');
const modalQuestSearch = $('#modal-quest-search');

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

const QUEST_ACTIONS = ['Pickup', 'Do', 'Side', 'Turnin'];
const DEFAULT_ACTIONS = ['Pickup', 'Do', 'Turnin'];
const ACTION_HINTS = { Side: 'Do this passively while focusing on the current main objective' };
function actionsHtml(actions) {
  return actions.map((action) => `<span class="action-${action.toLowerCase()}"${ACTION_HINTS[action] ? ` title="${ACTION_HINTS[action]}"` : ''}>${action}</span>`).join('/') || 'No actions';
}

function normalizeActions(actions) {
  if (!Array.isArray(actions)) return [...DEFAULT_ACTIONS];
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

// IDs that were any-of prerequisites stay any-of; everything else typed in the field is required.
function prereqFieldToQuest(text, existing) {
  const ids = ForeverguideQuestPrereqs.idList(text.split(/[\s,]+/));
  const anyOf = ForeverguideQuestPrereqs.idList(existing?.preQuestSingle);
  return {
    requiresQuests: ids.filter((id) => !anyOf.includes(id)),
    preQuestSingle: anyOf.filter((id) => ids.includes(id)),
    preQuestGroup: [],
  };
}

function prereqFieldValue(quest) {
  const { all, any } = ForeverguideQuestPrereqs.requirements(quest);
  return [...all, ...any].join(', ');
}

function questNavButtonsHtml(quest, attrs) {
  const { all, any } = ForeverguideQuestPrereqs.requirements(quest);
  const button = (className, label, path) => `<button class="icon-button ${className}" ${attrs} aria-label="${label}" title="${label}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg></button>`;
  return (all.length + any.length ? button('show-prereq-btn', 'Show prerequisites in quest search', 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2Z') : '')
    + (questFollowups.has(normalizeQuestId(quest.questId)) ? button('show-followup-btn', 'Show follow-ups in quest search', 'M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8-8-8Z') : '');
}

function questLocationDetails(quest) {
  const objectiveText = Array.isArray(quest.objectiveText) ? quest.objectiveText.filter(Boolean) : [];
  const rows = [
    ['Quest text', objectiveText.join(' ')],
    ['Start', formatLocations([...(quest.starters?.npcs || []), ...(quest.starters?.objects || [])])],
    ['Turn-in', formatLocations([...(quest.turnIns?.npcs || []), ...(quest.turnIns?.objects || [])])],
    ['Objectives', formatLocations(quest.objectiveLocations || [])],
    ['Completion', formatWaypoints(quest.completionWaypoints || [])],
  ].filter(([, value]) => value);
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
  return { name, questLevel: 1, xp: 0, faction: 'Both', questId: null, actions: [...DEFAULT_ACTIONS] };
}

function createDungeon(index = routeState.length) {
  return normalizeDungeon({ name: `Custom step ${index + 1}`, url: '', levelRange: `${Math.max(1, index + 1)}-${Math.max(10, index + 10)}`, quests: [createQuest()], xpFromMonsters: 0 });
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
  const cardHtml = (raw, index, forEditModal) => {
    const dungeon = normalizeDungeon(raw);
    if (!forEditModal) {
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
          <div class="card-icon-actions"><button class="icon-button edit-dungeon-btn" data-index="${index}" aria-label="Edit ${escapeHtml(dungeon.name)}" title="Edit dungeon or step"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16.5V20h3.5L18 9.5 14.5 6 4 16.5Zm16.7-10.8a1 1 0 0 0 0-1.4l-2-2a1 1 0 0 0-1.4 0l-1.7 1.7 3.4 3.4 1.7-1.7Z"/></svg></button>
          <button class="icon-button danger-icon delete-dungeon-btn" data-index="${index}" aria-label="Delete ${escapeHtml(dungeon.name)}" title="Delete dungeon or step"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"/></svg></button></div></div>
        ${dependencyDetails ? `<div class="dungeon-card-dependencies">${dependencyDetails}</div>` : ''}
        <details class="card-quest-details"><summary>View quest details</summary><ul class="dungeon-card-quests">${dungeon.quests.map((quest, questIndex) => `<li data-quest-index="${questIndex}" data-quest-id="${quest.questId ?? ''}" draggable="${editingIndex === null}"><div>${linkedName(quest.name, questUrl(quest.questId))}${warningKeys.has(`${dungeon.name}|${quest.questId}`) ? ' <span class="prereq-flag" title="Missing prerequisite quests">⚠ missing prerequisite</span>' : ''} <span>${quest.faction} · Lvl ${quest.questLevel} · ${quest.xp.toLocaleString()} XP · ${actionsHtml(quest.actions)}</span>${questLocationDetails(quest)}</div><div class="quest-item-actions"><button class="icon-button find-quest-btn" data-dungeon-index="${index}" data-quest-index="${questIndex}" aria-label="Show ${escapeHtml(quest.name)} in quest search" title="Show in quest search"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14Z"/></svg></button>${questNavButtonsHtml(quest, `data-dungeon-index="${index}" data-quest-index="${questIndex}"`)}<button class="icon-button danger-icon remove-route-quest-btn" data-dungeon-index="${index}" data-quest-index="${questIndex}" aria-label="Remove ${escapeHtml(quest.name)} from route" title="Remove quest from route"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"/></svg></button></div></li>`).join('')}</ul></details>
      </article>`;
    }
    return `<article class="dungeon-card is-editing" data-index="${index}" data-name="${escapeHtml(dungeon.name)}">
      <div class="dungeon-edit-heading"><h3>Edit dungeon or step</h3><button class="icon-button cancel-edit-btn" data-index="${index}" aria-label="Cancel editing" title="Cancel editing"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m19 6.4-1.4-1.4L12 10.6 6.4 5 5 6.4l5.6 5.6L5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4Z"/></svg></button></div>
      <div class="dungeon-header"><div class="field-group dungeon-name-field"><label>Dungeon or step name</label><input class="dungeon-name" value="${escapeHtml(dungeon.name)}" /></div>
        <div class="field-group dungeon-url-field"><label>Dungeon or step URL</label><input class="dungeon-url" type="url" value="${escapeHtml(dungeon.url)}" placeholder="https://" /></div>
        <div class="field-group dungeon-range-field"><label>Level range</label><input class="dungeon-range" value="${escapeHtml(dungeon.levelRange)}" /></div>
        <div class="field-group dungeon-monster-xp-field"><label>Experience from monsters</label><input class="dungeon-monster-xp" type="number" min="0" value="${dungeon.xpFromMonsters}" /></div>
        <div class="field-group dungeon-dependency-field"><label>Requires completion of</label><input class="dependency-search" type="search" placeholder="Search dungeon/step" aria-label="Search required dungeons or steps" /><select class="dungeon-dependencies" multiple size="3" aria-label="Dungeons or steps that must be completed first">${dependencyOptions(index, dungeon.dependencies)}</select></div>
        <div class="field-group dungeon-dependency-field"><label>Completion unlocks</label><input class="downstream-dependency-search" type="search" placeholder="Search dungeon/step" aria-label="Search unlocked dungeons or steps" /><select class="dungeon-downstream-dependencies" multiple size="3" aria-label="Dungeons or steps unlocked by completion">${dependencyOptions(index, routeState.flatMap((candidate, candidateIndex) => candidateIndex !== index && normalizeDungeon(candidate).dependencies.some((dependency) => dependency.dungeonName === dungeon.name) ? [{ dungeonName: normalizeDungeon(candidate).name }] : []))}</select></div></div>
      <div class="quest-list">${dungeon.quests.map((quest, questIndex) => `<div class="quest-row" data-quest-index="${questIndex}">
        <button type="button" class="icon-button quest-drag-handle" aria-label="Drag to reorder quest" title="Drag to reorder"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h2v2H9V5Zm4 0h2v2h-2V5ZM9 11h2v2H9v-2Zm4 0h2v2h-2v-2ZM9 17h2v2H9v-2Zm4 0h2v2h-2v-2Z"/></svg></button>
        <div class="field-group quest-field"><label>Quest</label><input class="quest-name" value="${escapeHtml(quest.name)}" /></div>
        <div class="field-group quest-id-field"><label>Quest ID</label><input class="quest-id" type="number" min="1" step="1" value="${quest.questId ?? ''}" placeholder="Quest ID" /></div>
        <div class="field-group quest-level-field"><label>Quest level</label><input class="quest-level" type="number" min="1" max="60" value="${quest.questLevel}" /></div>
        <div class="field-group quest-xp-field"><label>XP reward</label><input class="quest-xp" type="number" min="0" value="${quest.xp}" /></div>
        <div class="field-group quest-faction-field"><label>Faction</label><select class="quest-faction">${factionOptions(quest.faction)}</select></div>
        <div class="field-group quest-requires-field"><label>Prerequisites</label><input class="quest-requires" value="${prereqFieldValue(quest)}" placeholder="Quest IDs, e.g. 96392" /></div>
        <div class="field-group quest-actions-field"><label>Actions</label><div class="quest-actions">${QUEST_ACTIONS.map((action) => `<label${ACTION_HINTS[action] ? ` title="${ACTION_HINTS[action]}"` : ''}><input type="checkbox" class="quest-action" value="${action}"${quest.actions.includes(action) ? ' checked' : ''} /> <span class="action-${action.toLowerCase()}">${action}</span></label>`).join('')}</div></div>
        <button class="icon-button find-quest-btn" data-quest-index="${questIndex}" aria-label="Show quest in quest search" title="Show in quest search"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14Z"/></svg></button>
        ${questNavButtonsHtml(quest, `data-quest-index="${questIndex}"`)}
        <button class="icon-button duplicate-quest-btn" data-quest-index="${questIndex}" aria-label="Duplicate quest" title="Duplicate quest"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"/></svg></button>
        <button class="icon-button danger-icon remove-quest-btn" data-quest-index="${questIndex}" aria-label="Remove quest" title="Remove quest"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"/></svg></button>
      </div>`).join('')}</div><div class="card-edit-actions"><button class="secondary-button add-quest-btn">Add quest</button><button class="save-dungeon-btn">Done</button></div></article>`;
  };
  routeEditor.innerHTML = routeState.length ? routeState.map((raw, index) => cardHtml(raw, index, false)).join('') : '<p class="empty-state route-drop-empty">Your route is empty. Drag a dungeon here or add a custom step to get started.</p>';
  if (editingIndex === null) {
    if (editModal.open) editModal.close();
    editForm.innerHTML = '';
  } else {
    const scrollTop = editForm.scrollTop;
    editForm.innerHTML = cardHtml(routeState[editingIndex], editingIndex, true);
    if (!editModal.open) editModal.showModal();
    editForm.scrollTop = scrollTop;
    renderModalQuestPool();
  }
  routeEditor.querySelectorAll('.dungeon-card').forEach((card) => {
    const details = card.querySelector('details');
    if (details && openQuestDetails.has(card.dataset.name)) details.open = true;
  });
  const selectedTarget = routeState.some((dungeon) => normalizeDungeon(dungeon).name === questTarget.value) ? questTarget.value : '';
  questTarget.innerHTML = '<option value="">Choose a route dungeon or step</option>' + routeState.map((dungeon) => {
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
    return `<article class="pool-item" data-pool-dungeon-index="${index}"><div><h3>${escapeHtml(dungeon.name)}</h3><p>Levels ${escapeHtml(dungeon.levelRange)} · ${dungeon.quests.length} quests</p></div><button class="secondary-button add-pool-dungeon-btn" data-index="${index}"${isAdded ? ' disabled' : ''}>${isAdded ? 'In route' : 'Add'}</button></article>`;
  }).join('') || '<p class="empty-state">No dungeons match that search.</p>';
}

function questPoolCopyHtml(quest) {
  return `<div class="pool-item-copy"><h3>${linkedName(quest.name, questUrl(quest.questId))}</h3><p>#${quest.questId} · ${quest.zone || 'Zone unknown'} · Lvl ${quest.requiredLevel} req / ${quest.questLevel} quest · ${quest.xp.toLocaleString()} XP · ${quest.faction}</p>${questLocationDetails(quest)}</div>`;
}

function matchesQuestQuery(quest, query) {
  const ids = [...query.matchAll(/#\s*(\d+)/g)].map((match) => Number(match[1]));
  if (ids.length && !query.replace(/#\s*\d+|[\s,]+/g, '')) return ids.includes(quest.questId);
  return !query || `${quest.name} ${quest.questId} ${quest.zone || ''}`.toLocaleLowerCase().includes(query);
}

function renderModalQuestPool() {
  const query = modalQuestSearch.value.trim().toLocaleLowerCase();
  const filtered = questsForFaction(questCatalog).filter((quest) => matchesQuestQuery(quest, query));
  const visible = filtered.slice(0, 80);
  $('#modal-quest-count').textContent = `(${filtered.length.toLocaleString()})`;
  modalQuestPool.innerHTML = visible.map((quest) => `<article class="pool-item quest-pool-item" data-pool-quest-id="${quest.questId}">
    ${questPoolCopyHtml(quest)}
    <button type="button" class="secondary-button add-modal-quest-btn" data-quest-id="${quest.questId}">Add</button>
  </article>`).join('') || '<p class="empty-state">No quests match that search.</p>';
  if (filtered.length > visible.length) modalQuestPool.insertAdjacentHTML('beforeend', `<p class="pool-limit-note">Showing ${visible.length} of ${filtered.length.toLocaleString()}. Refine your search to see more.</p>`);
}

function renderQuestPool() {
  const query = questSearch.value.trim().toLocaleLowerCase();
  const filtered = questsForFaction(questCatalog).filter((quest) => matchesQuestQuery(quest, query));
  const visible = filtered.slice(0, 80);
  $('#quest-pool-count').textContent = `(${filtered.length.toLocaleString()})`;
  const remaining = filtered.length - visible.length;
  questPool.innerHTML = visible.map((quest) => `<article class="pool-item quest-pool-item" data-pool-quest-id="${quest.questId}">
    ${questPoolCopyHtml(quest)}
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
    importExportStatus.textContent = 'Add a dungeon or step to your route, then choose it as the quest destination.';
    return;
  }
  const dungeon = normalizeDungeon(routeState[dungeonIndex]);
  setRouteExpanded(true);
  dungeon.quests.push(normalizeQuest(structuredClone(quest)));
  routeState[dungeonIndex] = dungeon;
  renderEditor();
  renderPools();
  runPlanner();
}

function syncEditingDungeon() {
  if (editingIndex === null) return;
  const card = editForm.querySelector('.dungeon-card');
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
      ...prereqFieldToQuest(row.querySelector('.quest-requires').value, existingQuests[questIndex]),
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
  if (totalXp >= maxXp) endReason = { title: 'Maximum level reached', message: `The route reached level ${MAX_LEVEL}. No more XP is needed for leveling.` };
  else if (!next) endReason = { title: 'Route completed', message: 'Every dungeon and step in the route was completed with all prerequisites met.' };
  else if (missingDependencies(next, completedDungeons).length) {
    const missing = missingDependencies(next, completedDungeons).map((dependency) => dependency.dungeonName).join(', ');
    endReason = { title: 'Dungeon or step prerequisite not completed', message: `${next.name} requires completion of ${missing} before it can be entered.` };
  }
  else if (progress.value < next.minLevel) {
    const needed = Math.max(0, (xpTable[next.minLevel] || totalXp) - totalXp);
    endReason = { title: 'Not high enough to enter the next dungeon or step', message: `The next dungeon or step is ${next.name} (minimum level ${next.minLevel}). You are level ${progress.display} and need ${needed.toLocaleString()} more XP to enter it.` };
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
  const duplicateWarnings = duplicateActionWarnings(result.route);
  duplicateStatus.hidden = !duplicateWarnings.length;
  duplicateStatus.innerHTML = duplicateWarnings.length
    ? `<strong>${duplicateWarnings.length} quest action${duplicateWarnings.length === 1 ? '' : 's'} repeated in the route:</strong><ul>${duplicateWarnings.map(({ action, quest, steps }) => `<li>${linkedName(quest.name, questUrl(quest.questId))}${quest.questId ? ` (${quest.questId})` : ''} is ${action === 'Pickup' ? 'picked up' : 'turned in'} ${steps.length} times: ${steps.map((step) => `${escapeHtml(step.label)} <a href="#" class="prereq-jump" data-dungeon="${escapeHtml(step.dungeon)}" data-quest-id="${quest.questId ?? ''}">Go to quest</a>`).join(', ')}</li>`).join('')}</ul>`
    : '';
  $('#summary-start-level').textContent = startProgress.display;
  const routeQuestCount = result.route.reduce((sum, step) => sum + step.quests.length, 0);
  $('#summary-route-length').textContent = `${result.completedDungeonCount} steps (${routeQuestCount} quests)`;
  $('#summary-final-level').textContent = result.finalProgress.display;
  routeOutput.innerHTML = result.route.length ? result.route.map((step, index) => `<article class="route-step"><h3>Step ${index + 1}: ${linkedName(step.dungeon.name, step.dungeon.url)}</h3><p><strong>Level range:</strong> ${escapeHtml(step.dungeon.levelRange)}</p><p><strong>Earned:</strong> ${(step.questXp + step.monsterXp).toLocaleString()} XP (${step.questXp.toLocaleString()} from quests + ${step.monsterXp.toLocaleString()} from monsters)</p><p><strong>Level progression:</strong> started at level ${step.start} and ended at level ${step.end} (${step.totalXp.toLocaleString()} XP total)</p><ul>${step.quests.map((quest) => `<li>${linkedName(quest.name, questUrl(quest.questId))} — Level ${quest.questLevel} — ${actionsHtml(quest.actions)} — ${rewardedXp(quest).toLocaleString()} XP${questLocationDetails(quest)}</li>`).join('')}</ul></article>`).join('') : `<p class="empty-state">${eligiblePool.length ? 'No valid dungeon route was found for this starting level and route.' : 'Your route is empty. Add a dungeon from the pool to plan XP.'}</p>`;
  reasonsOutput.innerHTML = `<article class="reason-item route-ending-summary"><h3>${escapeHtml(result.endReason.title)}</h3><p>${escapeHtml(result.endReason.message)}</p></article>`;
}

function saveAndClose() {
  const card = editForm.querySelector('.dungeon-card');
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

function addQuestToEditing(questId, insertAt) {
  const quest = questCatalogById.get(questId);
  if (!quest || editingIndex === null) return;
  syncEditingDungeon();
  const quests = routeState[editingIndex].quests;
  quests.splice(insertAt ?? quests.length, 0, normalizeQuest(structuredClone(quest)));
  renderEditor(); renderPools(); runPlanner();
  if (insertAt === undefined) editForm.scrollTop = editForm.scrollHeight;
}

function cancelEdit(index) {
  if (isNewDungeon) routeState.splice(index, 1);
  else if (originalDungeon) routeState[index] = originalDungeon;
  editingIndex = null; originalDungeon = null; isNewDungeon = false;
  renderEditor(); renderPools(); runPlanner();
}

function duplicateActionWarnings(route) {
  const seen = new Map();
  route.forEach((step, stepIndex) => step.quests.forEach((quest) => {
    const key = quest.questId ?? `name:${quest.name.toLocaleLowerCase()}`;
    for (const action of ['Pickup', 'Turnin']) {
      if (!quest.actions.includes(action)) continue;
      const entry = seen.get(`${action}|${key}`) ?? { action, quest, steps: [] };
      entry.steps.push({ label: `Step ${stepIndex + 1} (${step.dungeon.name})`, dungeon: step.dungeon.name });
      seen.set(`${action}|${key}`, entry);
    }
  }));
  return [...seen.values()].filter((entry) => entry.steps.length > 1);
}

function addDungeonToPool() {
  setRouteExpanded(true);
  routeState.push(createDungeon());
  editingIndex = routeState.length - 1;
  originalDungeon = null;
  isNewDungeon = true;
  renderEditor();
  editForm.querySelector('.dungeon-name')?.focus();
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
  importExportStatus.textContent = `Imported route with ${routeState.length} dungeons and steps.`;
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

function onEditorEvent(type, handler) {
  routeEditor.addEventListener(type, handler);
  editForm.addEventListener(type, handler);
}

editModal.addEventListener('cancel', (event) => {
  event.preventDefault();
  if (editingIndex !== null) cancelEdit(editingIndex);
});
modalQuestSearch.addEventListener('input', renderModalQuestPool);
modalQuestPool.addEventListener('click', (event) => {
  const button = event.target.closest('.add-modal-quest-btn');
  if (button) addQuestToEditing(Number(button.dataset.questId));
});
onEditorEvent('input', (event) => {
  if (event.target.matches('.dependency-search, .downstream-dependency-search')) {
    const search = event.target.value.trim().toLocaleLowerCase();
    const select = event.target.parentElement.querySelector(event.target.classList.contains('dependency-search') ? '.dungeon-dependencies' : '.dungeon-downstream-dependencies');
    for (const option of select.options) option.hidden = !option.textContent.toLocaleLowerCase().includes(search);
  } else if (event.target.matches('.dungeon-name, .dungeon-url, .dungeon-range, .dungeon-monster-xp, .quest-name, .quest-id, .quest-level, .quest-xp, .quest-requires')) syncEditingDungeon();
});
onEditorEvent('change', (event) => {
  if (event.target.matches('.dungeon-dependencies, .dungeon-downstream-dependencies, .quest-faction, .quest-action')) syncEditingDungeon();
});
dungeonPool.addEventListener('click', (event) => {
  const button = event.target.closest('.add-pool-dungeon-btn');
  if (button) addDungeonFromPool(Number(button.dataset.index));
});
function jumpToQuest(event) {
  const link = event.target.closest('.prereq-jump');
  if (!link) return;
  event.preventDefault();
  selectTab('planner');
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
}
prereqStatus.addEventListener('click', jumpToQuest);
duplicateStatus.addEventListener('click', jumpToQuest);

questPool.addEventListener('click', (event) => {
  const button = event.target.closest('.add-pool-quest-btn');
  if (button) addQuestFromPool(button.dataset.questId);
});
dungeonSearch.addEventListener('input', renderDungeonPool);
questSearch.addEventListener('input', renderQuestPool);
questTarget.addEventListener('change', renderQuestPool);
onEditorEvent('dragstart', (event) => {
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
onEditorEvent('dragover', (event) => {
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
onEditorEvent('drop', (event) => {
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
onEditorEvent('dragend', () => {
  draggedDungeonIndex = null;
  draggedQuest = null;
  routeEditor.querySelectorAll('.dungeon-card.is-dragging, .dungeon-card.is-drop-target')
    .forEach((card) => card.classList.remove('is-dragging', 'is-drop-target'));
  routeEditor.querySelectorAll('.dungeon-card-quests li.is-quest-dragging, .dungeon-card-quests li.is-quest-drop-target')
    .forEach((quest) => quest.classList.remove('is-quest-dragging', 'is-quest-drop-target'));
  editForm.querySelectorAll('.quest-row.is-quest-dragging, .quest-row.is-quest-drop-target')
    .forEach((row) => row.classList.remove('is-quest-dragging', 'is-quest-drop-target'));
});
onEditorEvent('click', (event) => {
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
    cancelEdit(index);
  } else if (button.matches('.find-quest-btn, .show-prereq-btn, .show-followup-btn')) {
    const dungeonIndex = button.dataset.dungeonIndex === undefined ? editingIndex : Number(button.dataset.dungeonIndex);
    if (editingIndex !== null) syncEditingDungeon();
    const quest = routeState[dungeonIndex]?.quests[Number(button.dataset.questIndex)];
    if (quest) showQuestInPool(quest, button.classList.contains('show-prereq-btn') ? 'prereq' : button.classList.contains('show-followup-btn') ? 'followup' : 'self');
  } else if (button.classList.contains('duplicate-quest-btn')) {
    syncEditingDungeon();
    const quests = routeState[editingIndex].quests;
    const questIndex = Number(button.dataset.questIndex);
    quests.splice(questIndex + 1, 0, structuredClone(quests[questIndex]));
    renderEditor(); runPlanner();
  } else if (button.classList.contains('add-quest-btn')) {
    syncEditingDungeon(); routeState[editingIndex].quests.push(createQuest(`New quest ${routeState[editingIndex].quests.length + 1}`)); renderEditor();
  } else if (button.classList.contains('remove-quest-btn')) {
    syncEditingDungeon(); routeState[editingIndex].quests.splice(Number(button.dataset.questIndex), 1); renderEditor();
  } else if (button.classList.contains('save-dungeon-btn')) saveAndClose();
});

$('#calculate-btn').addEventListener('click', () => {
  runPlanner();
  selectTab('recommended');
});
function selectTab(name) {
  for (const id of ['planner', 'recommended']) {
    const active = id === name;
    const tab = $(`#tab-${id}`);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    $(`#${id}-tab-panel`).hidden = !active;
  }
  window.scrollTo({ top: 0 });
}
$('#tab-planner').addEventListener('click', () => selectTab('planner'));
$('#tab-recommended').addEventListener('click', () => selectTab('recommended'));
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
  if (!window.confirm('Clear every dungeon, step, and quest from the route? This cannot be undone.')) return;
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

// Pointer-based (not native) drag so the wheel and edge auto-scroll keep working while holding a quest.
editForm.addEventListener('pointerdown', (event) => {
  const handle = event.target.closest('.quest-drag-handle');
  if (!handle || event.button !== 0 || editingIndex === null) return;
  event.preventDefault();
  syncEditingDungeon();
  const row = handle.closest('.quest-row');
  const sourceIndex = Number(row.dataset.questIndex);
  let pointerY = event.clientY;
  let targetRow = null;
  let insertAfter = false;
  handle.setPointerCapture?.(event.pointerId);
  row.classList.add('is-quest-dragging');
  const clearMarks = () => editForm.querySelectorAll('.is-quest-drop-target').forEach((el) => el.classList.remove('is-quest-drop-target'));
  const updateTarget = () => {
    clearMarks();
    targetRow = [...editForm.querySelectorAll('.quest-row')].find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return pointerY >= rect.top && pointerY <= rect.bottom;
    }) ?? null;
    if (!targetRow) return;
    const rect = targetRow.getBoundingClientRect();
    insertAfter = pointerY > rect.top + rect.height / 2;
    targetRow.classList.add('is-quest-drop-target');
  };
  const timer = setInterval(() => {
    const rect = editForm.getBoundingClientRect();
    if (pointerY < rect.top + 60) editForm.scrollTop -= 14;
    else if (pointerY > rect.bottom - 60) editForm.scrollTop += 14;
    updateTarget();
  }, 16);
  const onMove = (moveEvent) => { pointerY = moveEvent.clientY; };
  const finish = (endEvent) => {
    clearInterval(timer);
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', finish);
    handle.removeEventListener('pointercancel', finish);
    pointerY = endEvent.clientY ?? pointerY;
    if (endEvent.type === 'pointerup') updateTarget();
    clearMarks();
    row.classList.remove('is-quest-dragging');
    if (endEvent.type !== 'pointerup' || !targetRow) return;
    let insertionIndex = Number(targetRow.dataset.questIndex) + Number(insertAfter);
    if (sourceIndex < insertionIndex) insertionIndex -= 1;
    const quests = routeState[editingIndex].quests;
    const [quest] = quests.splice(sourceIndex, 1);
    quests.splice(Math.max(0, Math.min(insertionIndex, quests.length)), 0, quest);
    renderEditor();
    runPlanner();
  };
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
});

// Browsers don't scroll containers while dragging, so nudge the nearest scrollable ancestor near its edge.
function edgeScroll(startEl, clientY) {
  const edge = 70;
  const step = 18;
  for (let el = startEl instanceof Element ? startEl : null; el && el !== document.documentElement; el = el.parentElement) {
    if (!/(auto|scroll)/.test(getComputedStyle(el).overflowY) || el.scrollHeight <= el.clientHeight) continue;
    const rect = el.getBoundingClientRect();
    const delta = clientY < rect.top + edge ? -step : clientY > rect.bottom - edge ? step : 0;
    const before = el.scrollTop;
    el.scrollTop += delta;
    if (delta && el.scrollTop !== before) return;
  }
  if (clientY < edge) window.scrollBy(0, -step);
  else if (clientY > window.innerHeight - edge) window.scrollBy(0, step);
}
document.addEventListener('dragover', (event) => edgeScroll(event.target, event.clientY));

// Pointer-based pool drag: native drags block the mousewheel, which is needed to reach far-away route cards.
function enablePoolDrag(pool, itemSelector, zoneSelector, resolveDrop) {
  pool.addEventListener('pointerdown', (event) => {
    const item = event.target.closest(itemSelector);
    if (!item || event.button !== 0 || event.pointerType === 'touch' || event.target.closest('button, a, summary, input, select')) return;
    let pointerX = event.clientX;
    let pointerY = event.clientY;
    let ghost = null;
    let timer = 0;
    const pointAt = () => document.elementFromPoint?.(pointerX, pointerY) ?? null;
    const clearMarks = () => document.querySelectorAll('.is-drop-target, .is-quest-drop-target').forEach((el) => el.classList.remove('is-drop-target', 'is-quest-drop-target'));
    const currentDrop = () => {
      const el = pointAt();
      return el?.closest(zoneSelector) ? resolveDrop(item, el, pointerY) : null;
    };
    const markDrop = () => {
      const drop = currentDrop();
      drop?.card?.classList.add(drop.markClass ?? 'is-drop-target');
    };
    const begin = () => {
      ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.textContent = item.querySelector('h3')?.textContent ?? '';
      (editModal.open ? editModal : document.body).append(ghost);
      document.body.classList.add('is-pool-dragging');
      window.getSelection()?.removeAllRanges();
      item.setPointerCapture?.(event.pointerId);
      timer = setInterval(() => {
        edgeScroll(pointAt(), pointerY);
        clearMarks();
        markDrop();
      }, 16);
    };
    const onMove = (moveEvent) => {
      pointerX = moveEvent.clientX;
      pointerY = moveEvent.clientY;
      if (!ghost && Math.hypot(pointerX - event.clientX, pointerY - event.clientY) > 5) begin();
      if (ghost) ghost.style.transform = `translate(${pointerX + 14}px, ${pointerY + 14}px)`;
    };
    const finish = (endEvent) => {
      item.removeEventListener('pointermove', onMove);
      item.removeEventListener('pointerup', finish);
      item.removeEventListener('pointercancel', finish);
      if (!ghost) return;
      clearInterval(timer);
      pointerX = endEvent.clientX ?? pointerX;
      pointerY = endEvent.clientY ?? pointerY;
      const drop = endEvent.type === 'pointerup' ? currentDrop() : null;
      clearMarks();
      ghost.remove();
      document.body.classList.remove('is-pool-dragging');
      drop?.commit();
    };
    item.addEventListener('pointermove', onMove);
    item.addEventListener('pointerup', finish);
    item.addEventListener('pointercancel', finish);
  });
}
enablePoolDrag(dungeonPool, '.pool-item', '#route-editor', (item, el) => {
  if (item.querySelector('.add-pool-dungeon-btn')?.disabled) return null;
  const card = el.closest('.dungeon-card:not(.is-editing)');
  return { card, commit: () => addDungeonFromPool(Number(item.dataset.poolDungeonIndex), card ? Number(card.dataset.index) : routeState.length) };
});
enablePoolDrag(questPool, '.quest-pool-item', '#route-editor', (item, el) => {
  const card = el.closest('.dungeon-card:not(.is-editing)');
  return card && { card, commit: () => addQuestFromPool(Number(item.dataset.poolQuestId), routeState[Number(card.dataset.index)].name) };
});
enablePoolDrag(modalQuestPool, '.quest-pool-item', '#edit-modal-form', (item, el, pointerY) => {
  const row = el.closest('.quest-row');
  const questId = Number(item.dataset.poolQuestId);
  if (!row) return { card: el.closest('.dungeon-card'), commit: () => addQuestToEditing(questId) };
  const rect = row.getBoundingClientRect();
  const insertAt = Number(row.dataset.questIndex) + Number(pointerY > rect.top + rect.height / 2);
  return { card: row, markClass: 'is-quest-drop-target', commit: () => addQuestToEditing(questId, insertAt) };
});

// Native drags swallow normal wheel scrolling in some browsers, so forward it manually.
let isDragging = false;
document.addEventListener('dragstart', () => { isDragging = true; });
document.addEventListener('dragend', () => { isDragging = false; });
document.addEventListener('wheel', (event) => {
  if (!isDragging) return;
  event.preventDefault();
  const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  for (let el = event.target instanceof Element ? event.target : null; el && el !== document.documentElement; el = el.parentElement) {
    if (!/(auto|scroll)/.test(getComputedStyle(el).overflowY)) continue;
    const canScroll = delta < 0 ? el.scrollTop > 0 : el.scrollTop < el.scrollHeight - el.clientHeight - 1;
    if (!canScroll) continue;
    el.scrollTop += delta;
    return;
  }
  window.scrollBy(0, delta);
}, { passive: false });

function showQuestInPool(quest, mode = 'self') {
  const { all, any } = ForeverguideQuestPrereqs.requirements(quest);
  const ids = mode === 'prereq' ? [...all, ...any]
    : mode === 'followup' ? questFollowups.get(normalizeQuestId(quest.questId)) ?? []
      : [normalizeQuestId(quest.questId)].filter(Boolean);
  const query = ids.length ? ids.map((id) => `#${id}`).join(' ') : String(quest.name);
  if (editingIndex !== null) {
    modalQuestSearch.value = query;
    renderModalQuestPool();
    modalQuestPool.scrollTop = 0;
    modalQuestSearch.focus();
    return;
  }
  selectTab('planner');
  setSourcePoolExpanded(questPoolPanel, questPoolContent, toggleQuestsButton, true, 'Quests');
  questSearch.value = query;
  renderQuestPool();
  questPool.scrollTop = 0;
  questPoolPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

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
  questFollowups = new Map();
  for (const quest of questCatalog) {
    const { all, any } = ForeverguideQuestPrereqs.requirements(quest);
    for (const id of [...all, ...any]) questFollowups.set(id, [...(questFollowups.get(id) ?? []), quest.questId]);
  }
  defaultRoute.splice(0, defaultRoute.length, ...(Array.isArray(dungeonData) ? dungeonData.map(normalizeDungeon) : []));
  dungeonCatalog = structuredClone(defaultRoute);
  updateStartInput();
  routeState = [];
  renderEditor();
  renderPools();
  runPlanner();
});
