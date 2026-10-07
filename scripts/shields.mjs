// GURPS 4e B379, B408, B483-484; Shields Up! pp. 15-16.
// Calculations are pure. Defence rolls and wearer injury are never changed here.
export const MODES = ['basic', 'detailed', 'simple'];
export const DAMAGE_TYPES = ['cr', 'cut', 'imp', 'pi-', 'pi', 'pi+', 'pi++', 'burn'];
export const CONDITIONS = ['functional', 'disabled', 'destroyed', 'pulverised'];
export function number(value, label, min = 0, max = 1000000) {
  const n = Number(value);
  if (value === '' || value == null || !Number.isFinite(n) || n < min || n > max)
    throw new Error(`${label} must be a number from ${min} to ${max}.`);
  return n;
}
export function integer(value, label, min = 0, max = 1000000) {
  const n = number(value, label, min, max);
  if (!Number.isInteger(n)) throw new Error(`${label} must be a whole number.`);
  return n;
}
export function shieldRecord(input = {}) {
  const s = {
    id: input.id ?? 'shield',
    name: String(input.name ?? 'Shield').trim(),
    enabled: input.enabled === true,
    mode: input.mode ?? 'basic',
    db: integer(input.db ?? 2, 'DB', 0, 20),
    dr: integer(input.dr ?? 7, 'DR'),
    maxHP: integer(input.maxHP ?? 40, 'Maximum HP', 1),
    ht: integer(input.ht ?? 12, 'HT', 1, 30),
    construction: input.construction ?? 'homogeneous',
    canBlock: input.canBlock !== false,
    canCover: input.canCover !== false,
    massive: input.massive === true,
    totalCover: input.totalCover === true,
    enchanted: input.enchanted === true,
    magicLost: input.magicLost === true,
    artifact: input.artifact === true,
    cost: number(input.cost ?? 0, 'Base cost'),
    condition: input.condition ?? 'functional',
  };
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(s.id)) throw new Error('Invalid shield ID.');
  if (!s.name || s.name.length > 100) throw new Error('Use a shield name of 1–100 characters.');
  if (!MODES.includes(s.mode)) throw new Error('Unknown shield damage mode.');
  if (!['homogeneous', 'unliving', 'normal'].includes(s.construction))
    throw new Error('Unknown shield construction.');
  if (!CONDITIONS.includes(s.condition)) throw new Error('Unknown shield condition.');
  s.hp = integer(input.hp ?? s.maxHP, 'Current HP', -10 * s.maxHP, s.maxHP);
  s.hits = integer(input.hits ?? 0, 'Hits', 0, 7);
  s.coverDR = number(input.coverDR ?? s.dr + Math.floor(s.maxHP / 4), 'Cover DR');
  if (s.mode === 'simple' && s.coverDR <= 0)
    throw new Error('Simple damage needs positive Cover DR.');
  return s;
}
export function capabilities(input) {
  const s = shieldRecord(input);
  let condition = s.condition;
  if (s.mode === 'simple') {
    if (s.hits >= 7) condition = 'destroyed';
    else if (s.hits >= 4 && s.db <= 1) condition = 'disabled';
  } else if (s.mode === 'detailed') {
    if (s.hp <= -5 * s.maxHP) condition = 'pulverised';
    else if (s.hp <= -s.maxHP) condition = 'destroyed';
    else if (s.hp <= 0) condition = 'disabled';
  } else {
    if (s.hp <= -10 * s.maxHP) condition = 'pulverised';
    else if (s.hp <= -5 * s.maxHP) condition = 'destroyed';
  }
  const broken = ['destroyed', 'pulverised'].includes(condition);
  const disabled = condition === 'disabled';
  const battered = s.mode === 'simple' && s.hits >= 4;
  return {
    condition,
    db: broken || disabled ? 0 : battered ? 1 : s.db,
    canBlock: s.canBlock && !broken && (!disabled || (s.mode === 'detailed' && s.db >= 1)),
    canCover: s.canCover && !broken && !disabled,
    coverDR: s.coverDR / (battered ? 2 : 1),
  };
}
export function injuryMultiplier(type, construction = 'homogeneous') {
  if (!DAMAGE_TYPES.includes(type)) throw new Error('Unsupported damage type.');
  if (type === 'cut') return 1.5;
  const normal = { imp: 2, 'pi-': 0.5, pi: 1, 'pi+': 1.5, 'pi++': 2 };
  const homogeneous = { imp: 0.5, 'pi-': 0.1, pi: 0.2, 'pi+': 1 / 3, 'pi++': 0.5 };
  const unliving = { imp: 1, 'pi-': 0.2, pi: 1 / 3, 'pi+': 0.5, 'pi++': 1 };
  return { normal, homogeneous, unliving }[construction]?.[type] ?? 1;
}
export function coverAdvice(input, options = {}) {
  const s = shieldRecord(input);
  const c = capabilities(s);
  const use = options.use ?? 'cover';
  const legal = options.legal === true;
  const posture = integer(options.posture ?? 0, 'Protective posture modifier', 0, 10);
  const sm = integer(options.sm ?? 0, 'Size Modifier', -20, 20);
  const eligible = c.canCover && legal;
  let penalty = 0;
  if (eligible) penalty = use === 'take-ranged' ? Math.floor(c.db / 2) : c.db;
  const total = eligible && s.totalCover && penalty + posture >= 5 + sm;
  const margin =
    options.miss == null ? null : integer(options.miss, 'Attack miss margin', -100, 100);
  return {
    penalty,
    total,
    shieldHit: eligible && (total || (margin !== null && margin > 0 && margin <= penalty)),
    blockBonus: c.canBlock && legal && ['take-ranged', 'take-area'].includes(use) ? 1 : 0,
    areaAllowed: c.canCover && c.canBlock && c.db >= 3 && legal,
    coverDR: use === 'slung' ? s.dr : c.coverDR,
  };
}
function effectiveDR(dr, divisor) {
  if (divisor === 0) return 0; // Explicit ignores-DR selection.
  return Math.floor((divisor < 1 ? Math.max(1, dr) : dr) / divisor);
}
export function resolveShieldHit(input, attack = {}) {
  const s = shieldRecord(input);
  if (!s.enabled) throw new Error('Enable tracking for this shield first.');
  const before = capabilities(s);
  if (['destroyed', 'pulverised'].includes(before.condition))
    throw new Error('This shield is already destroyed. Use a manual correction if needed.');
  const damage = integer(attack.damage, 'Basic damage');
  const type = attack.type ?? 'cr';
  if (!DAMAGE_TYPES.includes(type))
    throw new Error('Special corrosion/flame effects are outside this version.');
  const divisor = number(attack.divisor ?? 1, 'Armour divisor', 0, 1000000);
  const reason = attack.reason ?? 'targeted';
  if (!['targeted', 'db', 'cover', 'slung', 'take-area', 'massive'].includes(reason))
    throw new Error('Choose how the shield was hit.');
  if (['cover', 'take-area'].includes(reason) && !before.canCover)
    throw new Error('This shield cannot provide cover.');
  if (reason === 'take-area' && (!before.canBlock || before.db < 3))
    throw new Error('Take Cover against area attacks requires a usable DB 3+ shield.');
  if (reason === 'db' && before.db === 0) throw new Error('This shield provides no DB.');
  if (reason === 'slung' && !s.canCover) throw new Error('This shield cannot provide cover.');
  let cover = reason === 'slung' ? s.dr : before.coverDR;
  if (reason === 'massive') {
    if (s.mode === 'basic' || !s.massive || !before.canBlock)
      throw new Error('Enable Massive Overpenetration on a usable Shields Up! shield.');
    if (attack.critical === true)
      return {
        shield: s,
        loss: 0,
        hits: 0,
        residual: 0,
        checks: [],
        stopped: true,
        notes: ['Critical Block stops the attack.'],
      };
    const margin = integer(attack.margin, 'Block success margin', 0, 100);
    if (margin < before.db) throw new Error('Use DB intercepted for a Block saved by its DB.');
    cover *= 2;
  }
  const next = { ...s };
  const notes = [];
  const checks = [];
  let loss = 0;
  let hits = 0;
  if (s.mode === 'simple') {
    // Simple mode expressly uses full cutting damage, unlike normal object injury.
    const adjusted = damage * (type === 'cut' ? 1 : injuryMultiplier(type, 'homogeneous'));
    const threshold = effectiveDR(before.coverDR, divisor);
    if (threshold <= 0 && damage > 0)
      throw new Error('Simple damage with zero effective Cover DR needs a manual hit ruling.');
    hits = threshold > 0 ? Math.floor(adjusted / threshold) : 0;
    next.hits = Math.min(7, s.hits + hits);
    notes.push(
      'Simple mode uses Cover DR at the start of this attack for all hit multiples; no fractional hits carry over.',
    );
  } else {
    const penetrating = Math.max(0, damage - effectiveDR(s.dr, divisor));
    loss =
      penetrating > 0
        ? Math.max(1, Math.floor(penetrating * injuryMultiplier(type, s.construction)))
        : 0;
    next.hp = Math.max(-10 * s.maxHP, s.hp - loss);
    if (s.mode === 'basic' && loss > 0) {
      for (let n = 1; n < 5; n++)
        if (s.hp > -n * s.maxHP && next.hp <= -n * s.maxHP)
          checks.push({ kind: 'destruction', target: s.ht, threshold: -n * s.maxHP });
      if (next.hp <= 0 && next.hp > -5 * s.maxHP)
        notes.push(
          'At 0 HP or below, check HT before each further use; failure disables the shield (B483).',
        );
    }
  }
  next.condition = capabilities(next).condition;
  if (s.mode !== 'basic' && ['destroyed', 'pulverised'].includes(next.condition))
    next.magicLost = s.magicLost || s.enchanted;
  const piercing = ['imp', 'pi-', 'pi', 'pi+', 'pi++'].includes(type);
  const presented = ['cover', 'slung', 'take-area', 'massive'].includes(reason);
  const penetrates = s.mode === 'basic' || (presented && (piercing || reason === 'slung'));
  const residual = penetrates ? Math.max(0, damage - effectiveDR(cover, divisor)) : 0;
  if (!penetrates && damage > s.dr && ['destroyed', 'pulverised'].includes(next.condition))
    notes.push(
      'Shield destroyed by a non-overpenetrating blow: GM decides any continuation; no automatic wearer damage.',
    );
  if (s.mode === 'basic' && residual > 0)
    notes.push('B484: roll 1d for location: 1–2 shield arm; 3–6 original target location.');
  notes.push('Resolve knockback separately. Wearer injury is not applied by this action.');
  return { shield: next, loss, hits, residual, checks, stopped: false, notes };
}
export function applyHTResult(input, kind, total) {
  const s = shieldRecord(input);
  if (s.mode !== 'basic') throw new Error('Only Basic Set uses shield HT checks.');
  if (!['use', 'destruction'].includes(kind)) throw new Error('Unknown HT check.');
  const roll = integer(total, '3d6 total', 3, 18);
  const success = roll <= 4 || (roll <= s.ht && roll < 17);
  return { ...s, condition: success ? s.condition : kind === 'use' ? 'disabled' : 'destroyed' };
}
export function repairShield(input, amount, die = 1) {
  const s = shieldRecord(input);
  const c = capabilities(s);
  if (s.artifact)
    throw new Error('An extraordinary artifact needs a GM ruling; use manual correction.');
  if (c.condition === 'pulverised') throw new Error('A pulverised shield cannot be repaired.');
  const next = { ...s };
  if (s.mode === 'simple') next.hits = Math.max(0, s.hits - integer(amount, 'Hits repaired', 1, 7));
  else next.hp = Math.min(s.maxHP, s.hp + integer(amount, 'HP restored', 1));
  if (s.mode === 'simple' ? next.hits < 4 : next.hp > 0) next.condition = 'functional';
  else if (s.mode === 'detailed' && next.hp > -s.maxHP) next.condition = 'disabled';
  // Repairs never restore enchantments.
  let cost = null;
  if (s.mode === 'detailed' && c.condition !== 'functional')
    cost =
      c.condition === 'destroyed' ? s.cost : (s.cost * integer(die, 'Repair cost die', 1, 6)) / 10;
  return { shield: next, cost };
}
