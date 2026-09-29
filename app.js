const MAX_LEVEL = 60;
const fallbackXp = { 1: 0 };
let xpTable = { ...fallbackXp };
let routeState = [];
let editingIndex = null;
let originalDungeon = null;
let isNewDungeon = false;
let draggedDungeonIndex = null;
let draggedQuest = null;
let shareRevision = 0;

const $ = (selector) => document.querySelector(selector);
const startModeInput = $('#start-mode');
const startValueInput = $('#start-value');
const startValueLabel = $('#start-value-label');
const factionInput = $('#faction');
const factionStatus = $('#faction-status');
let lastStartMode = startModeInput.value;
const routeEditor = $('#route-editor');
const routeOutput = $('#route-output');
const reasonsOutput = $('#reasons-output');
const poolContent = $('#pool-content');
const togglePoolButton = $('#toggle-pool-btn');
const importPoolFileInput = $('#import-pool-file');
const importExportStatus = $('#import-export-status');

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
    quests: Array.isArray(dungeon?.quests) ? dungeon.quests.map((quest) => ({
      name: String(quest?.name || 'New quest').trim() || 'New quest',
      questLevel: Math.max(1, Math.min(MAX_LEVEL, Number(quest?.questLevel) || 1)),
      xp: Math.max(0, Number(quest?.xp) || 0),
      faction: normalizeFaction(quest?.faction),
      questId: normalizeQuestId(quest?.questId),
    })) : [],
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
  return { name, questLevel: 1, xp: 0, faction: 'Both', questId: null };
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

function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

async function encodePayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream === 'function') {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return `v2.${toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()))}`;
  }
  return `v1.${toBase64Url(bytes)}`;
}

async function decodePayload(token) {
  const split = token.indexOf('.');
  const version = split < 0 ? null : token.slice(0, split);
  const encoded = split < 0 ? token : token.slice(split + 1);
  let bytes = fromBase64Url(encoded);
  if (version === 'v2') {
    if (typeof DecompressionStream !== 'function') throw new Error('Compressed route links are not supported by this browser.');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  } else if (version && version !== 'v1') {
    throw new Error('Unsupported route link version.');
  }
  return JSON.parse(new TextDecoder().decode(bytes));
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

async function readSharedRoute() {
  const match = window.location.hash.match(/^#route=(v[12]\.[A-Za-z0-9_-]+)$/);
  let payload;
  if (match) {
    payload = await decodePayload(match[1]);
  } else {
    const legacy = new URLSearchParams(window.location.search).get('route');
    if (!legacy) return null;
    payload = JSON.parse(decodeURIComponent(escape(atob(legacy.replace(/ /g, '+')))));
  }
  return routeFromPayload(payload);
}

async function updateShareUrl() {
  const revision = ++shareRevision;
  const token = await encodePayload(payloadFromState());
  if (revision !== shareRevision) return window.location.href;
  const url = new URL(window.location.href);
  url.searchParams.delete('route');
  url.hash = `route=${token}`;
  history.replaceState({}, '', url.href);
  return url.href;
}

function renderEditor() {
  const openQuestDetails = new Set([...routeEditor.querySelectorAll('.dungeon-card')]
    .filter((card) => card.querySelector('details')?.open)
    .map((card) => card.dataset.name));
  $('#pool-count').textContent = routeState.length ? `(${routeState.length})` : '(empty)';
  routeEditor.innerHTML = routeState.map((raw, index) => {
    const dungeon = normalizeDungeon(raw);
    if (editingIndex !== index) {
      const availableQuests = questsForFaction(dungeon.quests);
      const questXp = availableQuests.reduce((sum, quest) => sum + quest.xp, 0);
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
        <details class="card-quest-details"><summary>View quest details</summary><ul class="dungeon-card-quests">${dungeon.quests.map((quest, questIndex) => `<li data-quest-index="${questIndex}" draggable="${editingIndex === null}">${linkedName(quest.name, questUrl(quest.questId))} <span>${quest.faction} · Lvl ${quest.questLevel} · ${quest.xp.toLocaleString()} XP</span></li>`).join('')}</ul></details>
      </article>`;
    }
    return `<article class="dungeon-card is-editing" data-index="${index}" data-name="${escapeHtml(dungeon.name)}">
      <div class="dungeon-edit-heading"><h3>Edit dungeon</h3><button class="icon-button cancel-edit-btn" data-index="${index}" aria-label="Cancel editing" title="Cancel editing"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m19 6.4-1.4-1.4L12 10.6 6.4 5 5 6.4l5.6 5.6L5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4Z"/></svg></button></div>
      <div class="dungeon-header"><div class="field-group dungeon-name-field"><label>Dungeon name</label><input class="dungeon-name" value="${escapeHtml(dungeon.name)}" /></div>
        <div class="field-group dungeon-url-field"><label>Dungeon URL</label><input class="dungeon-url" type="url" value="${escapeHtml(dungeon.url)}" placeholder="https://" /></div>
        <div class="field-group dungeon-range-field"><label>Dungeon level range</label><input class="dungeon-range" value="${escapeHtml(dungeon.levelRange)}" /></div>
        <div class="field-group dungeon-monster-xp-field"><label>Experience from monsters</label><input class="dungeon-monster-xp" type="number" min="0" value="${dungeon.xpFromMonsters}" /></div>
        <div class="field-group dungeon-dependency-field"><label>Requires completion of</label><input class="dependency-search" type="search" placeholder="Search dungeons" aria-label="Search required dungeons" /><select class="dungeon-dependencies" multiple size="3" aria-label="Dungeons that must be completed first">${dependencyOptions(index, dungeon.dependencies)}</select></div>
        <div class="field-group dungeon-dependency-field"><label>Completion unlocks</label><input class="downstream-dependency-search" type="search" placeholder="Search dungeons" aria-label="Search unlocked dungeons" /><select class="dungeon-downstream-dependencies" multiple size="3" aria-label="Dungeons unlocked by completion">${dependencyOptions(index, routeState.flatMap((candidate, candidateIndex) => candidateIndex !== index && normalizeDungeon(candidate).dependencies.some((dependency) => dependency.dungeonName === dungeon.name) ? [{ dungeonName: normalizeDungeon(candidate).name }] : []))}</select></div></div>
      <div class="quest-list">${dungeon.quests.map((quest, questIndex) => `<div class="quest-row" data-quest-index="${questIndex}" draggable="true">
        <div class="field-group quest-field"><label>Quest</label><input class="quest-name" value="${escapeHtml(quest.name)}" /></div>
        <div class="field-group quest-id-field"><label>Quest ID</label><input class="quest-id" type="number" min="1" step="1" value="${quest.questId ?? ''}" placeholder="Quest ID" /></div>
        <div class="field-group quest-level-field"><label>Quest level</label><input class="quest-level" type="number" min="1" max="60" value="${quest.questLevel}" /></div>
        <div class="field-group quest-xp-field"><label>XP reward</label><input class="quest-xp" type="number" min="0" value="${quest.xp}" /></div>
        <div class="field-group quest-faction-field"><label>Faction</label><select class="quest-faction">${factionOptions(quest.faction)}</select></div>
        <button class="icon-button danger-icon remove-quest-btn" data-quest-index="${questIndex}" aria-label="Remove quest" title="Remove quest"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"/></svg></button>
      </div>`).join('')}</div><div class="card-edit-actions"><button class="secondary-button add-quest-btn">Add quest</button><button class="save-dungeon-btn">Done</button></div></article>`;
  }).join('');
  routeEditor.querySelectorAll('.dungeon-card').forEach((card) => {
    const details = card.querySelector('details');
    if (details && openQuestDetails.has(card.dataset.name)) details.open = true;
  });
}

function syncEditingDungeon() {
  if (editingIndex === null) return;
  const card = routeEditor.querySelector(`.dungeon-card[data-index="${editingIndex}"]`);
  if (!card) return;
  routeState[editingIndex] = normalizeDungeon({
    name: card.querySelector('.dungeon-name').value,
    url: card.querySelector('.dungeon-url').value,
    levelRange: card.querySelector('.dungeon-range').value,
    xpFromMonsters: card.querySelector('.dungeon-monster-xp').value,
    dependencies: selectedDependencies(card.querySelector('.dungeon-dependencies')),
    quests: [...card.querySelectorAll('.quest-row')].map((row) => ({
      name: row.querySelector('.quest-name').value,
      questId: row.querySelector('.quest-id').value,
      questLevel: row.querySelector('.quest-level').value,
      xp: row.querySelector('.quest-xp').value,
      faction: row.querySelector('.quest-faction').value,
    })),
  });
  updateShareUrl();
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
      const requiredLevel = Math.max(dungeon.minLevel, ...dungeon.quests.map((quest) => quest.questLevel));
      if (progressAt(totalXp).value < requiredLevel) continue;
      const start = progressAt(totalXp);
      const questXp = dungeon.quests.reduce((sum, quest) => sum + quest.xp, 0);
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
    const required = Math.max(next.minLevel, ...next.quests.map((quest) => quest.questLevel));
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
  factionStatus.textContent = `Quests in Pool: ${factionCounts.Alliance} Alliance-only · ${factionCounts.Both} Both factions · ${factionCounts.Horde} Horde-only`;
  const eligiblePool = normalizedPool.map((dungeon) => ({ ...dungeon, quests: questsForFaction(dungeon.quests) }))
    .filter((dungeon) => dungeon.quests.length > 0 || dungeon.xpFromMonsters > 0);
  const result = getRoute(startXp, eligiblePool);
  $('#summary-start-level').textContent = startProgress.display;
  $('#summary-route-length').textContent = `${result.completedDungeonCount} dungeons`;
  $('#summary-final-level').textContent = result.finalProgress.display;
  routeOutput.innerHTML = result.route.length ? result.route.map((step, index) => `<article class="route-step"><h3>Step ${index + 1}: ${linkedName(step.dungeon.name, step.dungeon.url)}</h3><p><strong>Dungeon range:</strong> ${escapeHtml(step.dungeon.levelRange)}</p><p><strong>Earned:</strong> ${(step.questXp + step.monsterXp).toLocaleString()} XP (${step.questXp.toLocaleString()} from quests + ${step.monsterXp.toLocaleString()} from monsters)</p><p><strong>Level progression:</strong> started at level ${step.start} and ended at level ${step.end} (${step.totalXp.toLocaleString()} XP total)</p><ul>${step.quests.map((quest) => `<li>${linkedName(quest.name, questUrl(quest.questId))} — Level ${quest.questLevel} — ${quest.xp.toLocaleString()} XP</li>`).join('')}</ul></article>`).join('') : `<p class="empty-state">${eligiblePool.length ? 'No valid dungeon route was found for this starting level and pool.' : 'Your dungeon pool is empty. Add a dungeon with at least one quest.'}</p>`;
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
  updateShareUrl();
  renderEditor();
  runPlanner();
}

function addDungeonToPool() {
  setPoolExpanded(true);
  routeState.push(createDungeon());
  editingIndex = routeState.length - 1;
  originalDungeon = null;
  isNewDungeon = true;
  renderEditor();
  const editCard = routeEditor.querySelector('.dungeon-card.is-editing');
  editCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  editCard?.querySelector('.dungeon-name')?.focus({ preventScroll: true });
  updateShareUrl();
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
  link.download = 'foreverguide-pool.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
  importExportStatus.textContent = 'Dungeon pool and configuration exported.';
}

function importPoolJson(jsonText) {
  const payload = JSON.parse(jsonText);
  const importedRoute = routeFromPayload(payload);
  if (!importedRoute) throw new Error('The JSON file must contain a route array.');
  routeState = importedRoute;
  editingIndex = null;
  originalDungeon = null;
  isNewDungeon = false;
  setPoolExpanded(true);
  renderEditor();
  updateShareUrl();
  runPlanner();
  importExportStatus.textContent = `Imported ${routeState.length} dungeons and configuration.`;
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

function setPoolExpanded(expanded) {
  togglePoolButton.setAttribute('aria-expanded', String(expanded));
  togglePoolButton.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} dungeon pool`);
  togglePoolButton.title = `${expanded ? 'Collapse' : 'Expand'} dungeon pool`;
  poolContent.hidden = !expanded;
}

routeEditor.addEventListener('input', (event) => {
  if (event.target.matches('.dependency-search, .downstream-dependency-search')) {
    const search = event.target.value.trim().toLocaleLowerCase();
    const select = event.target.parentElement.querySelector(event.target.classList.contains('dependency-search') ? '.dungeon-dependencies' : '.dungeon-downstream-dependencies');
    for (const option of select.options) option.hidden = !option.textContent.toLocaleLowerCase().includes(search);
  } else if (event.target.matches('.dungeon-name, .dungeon-url, .dungeon-range, .dungeon-monster-xp, .quest-name, .quest-id, .quest-level, .quest-xp')) syncEditingDungeon();
});
routeEditor.addEventListener('change', (event) => {
  if (event.target.matches('.dungeon-dependencies, .dungeon-downstream-dependencies, .quest-faction')) syncEditingDungeon();
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
    updateShareUrl();
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
    updateShareUrl();
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
  updateShareUrl();
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
    updateShareUrl(); renderEditor(); runPlanner();
  } else if (button.classList.contains('cancel-edit-btn')) {
    if (isNewDungeon) routeState.splice(index, 1);
    else if (originalDungeon) routeState[index] = originalDungeon;
    editingIndex = null; originalDungeon = null; isNewDungeon = false;
    updateShareUrl(); renderEditor(); runPlanner();
  } else if (button.classList.contains('add-quest-btn')) {
    syncEditingDungeon(); routeState[editingIndex].quests.push(createQuest(`New quest ${routeState[editingIndex].quests.length + 1}`)); renderEditor();
  } else if (button.classList.contains('remove-quest-btn')) {
    syncEditingDungeon(); routeState[editingIndex].quests.splice(Number(button.dataset.questIndex), 1); renderEditor();
  } else if (button.classList.contains('save-dungeon-btn')) saveAndClose();
});

async function shareRoute(event) {
  const url = await updateShareUrl();
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText(url);
    const label = button.textContent;
    button.textContent = 'Link copied';
    setTimeout(() => { button.textContent = label; }, 1200);
  } catch {
    window.prompt('Copy the route link below:', url);
  }
}

$('#calculate-btn').addEventListener('click', () => {
  setPoolExpanded(false);
  runPlanner(); $('#summary-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('#route-share-btn').addEventListener('click', shareRoute);
$('#share-route-btn').addEventListener('click', shareRoute);
$('#add-dungeon-top-btn').addEventListener('click', addDungeonToPool);
$('#add-dungeon-btn').addEventListener('click', addDungeonToPool);
$('#export-pool-btn').addEventListener('click', exportPool);
$('#import-pool-btn').addEventListener('click', () => importPoolFileInput.click());
importPoolFileInput.addEventListener('change', importPoolFile);
$('#reset-route-btn').addEventListener('click', () => {
  routeState = structuredClone(defaultRoute); editingIndex = null; originalDungeon = null; isNewDungeon = false;
  renderEditor(); updateShareUrl(); runPlanner();
});
startModeInput.addEventListener('change', () => {
  const experience = startingExperience(lastStartMode);
  const nextMode = startModeInput.value;
  startValueInput.value = nextMode === 'xp' ? String(Math.round(experience)) : String(progressAt(experience).value);
  lastStartMode = nextMode;
  updateStartInput();
  updateShareUrl();
  runPlanner();
});
factionInput.addEventListener('change', () => {
  updateShareUrl();
  renderEditor();
  runPlanner();
});
togglePoolButton.addEventListener('click', () => {
  const expanded = togglePoolButton.getAttribute('aria-expanded') === 'true';
  setPoolExpanded(!expanded);
});
startValueInput.addEventListener('input', () => { updateShareUrl(); runPlanner(); });
startValueInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') $('#calculate-btn').click(); });

const defaultRoute = [];
Promise.all([
  fetch('./xp_per_level.json').then((response) => response.ok ? response.json() : null).catch(() => null),
  fetch('./dungeon_quest_db.json').then((response) => response.ok ? response.json() : []).catch(() => []),
]).then(async ([xpData, dungeonData]) => {
  if (Array.isArray(xpData?.levels)) {
    for (const row of xpData.levels) {
      if (Number.isFinite(Number(row.level)) && Number.isFinite(Number(row.totalXp))) xpTable[Number(row.level)] = Number(row.totalXp);
    }
  }
  defaultRoute.push(...(Array.isArray(dungeonData) ? dungeonData.map(normalizeDungeon) : []));
  updateStartInput();
  const shared = await readSharedRoute().catch((error) => { console.error('Could not read shared route.', error); return null; });
  routeState = shared !== null ? shared : structuredClone(defaultRoute);
  renderEditor();
  runPlanner();
});
