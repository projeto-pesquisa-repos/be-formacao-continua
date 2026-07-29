const { getDb } = require('../database');

/**
 * Get gamification data for a user
 * @param {number} userId 
 * @returns {Promise<Object>} Gamification data (xp, level, badges, nextLevelThreshold)
 */
async function getGamification(userId) {
  const db = getDb();
  
  // Get user gamification stats
  const stats = (await db.prepare('SELECT xp, level FROM user_gamification WHERE user_id = ?').get(userId)) || { xp: 0, level: 1 };
  
  // Get user badges
  const badges = await db.prepare(`
    SELECT b.id, b.name, b.description, b.icon, ub.awarded_at 
    FROM badges b
    JOIN user_badges ub ON b.id = ub.badge_id
    WHERE ub.user_id = ?
    ORDER BY ub.awarded_at DESC
  `).all(userId);

  return {
    xp: stats.xp,
    level: stats.level,
    nextLevelThreshold: stats.level * 1000,
    badges
  };
}

/**
 * Award a specific badge to a user
 * @param {number} userId 
 * @param {number} badgeId 
 */
async function awardBadge(userId, badgeId) {
  const db = getDb();
  try {
    await db.prepare('INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)').run(userId, badgeId);
  } catch (error) {
    console.error(`Failed to award badge ${badgeId} to user ${userId}:`, error);
  }
}

/**
 * Award XP to a user and recalculate level and badges
 * @param {number} userId 
 * @param {number} amount 
 */
async function awardXP(userId, amount) {
  const db = getDb();
  
  // Ensure user has a record
  await db.prepare('INSERT OR IGNORE INTO user_gamification (user_id, xp, level) VALUES (?, 0, 1)').run(userId);
  
  // Update XP
  await db.prepare('UPDATE user_gamification SET xp = xp + ? WHERE user_id = ?').run(amount, userId);
  
  // Recalculate level
  const stats = await db.prepare('SELECT xp, level FROM user_gamification WHERE user_id = ?').get(userId);
  const newLevel = Math.floor((stats ? stats.xp : 0) / 1000) + 1;
  
  if (stats && newLevel > stats.level) {
    await db.prepare('UPDATE user_gamification SET level = ? WHERE user_id = ?').run(newLevel, userId);
  }

  // Check for level up badges
  const unawardedLevelBadges = await db.prepare(`
    SELECT id FROM badges 
    WHERE requirement_type = 'level' 
      AND requirement_value <= ? 
      AND id NOT IN (SELECT badge_id FROM user_badges WHERE user_id = ?)
  `).all(newLevel, userId);

  for (const badge of unawardedLevelBadges) {
    await awardBadge(userId, badge.id);
  }

  // Also check for action badges
  await checkActionBadges(userId);
}

/**
 * Check and award all types of badges (action, stats, hours, streak, etc.)
 * @param {number} userId 
 */
async function checkActionBadges(userId) {
  const db = getDb();
  
  // 1. Get user gamification stats
  const stats = (await db.prepare('SELECT xp, level, streak FROM user_gamification WHERE user_id = ?').get(userId))
    || { xp: 0, level: 1, streak: 0 };
  
  // 2. Get counts of approved actions by type
  const approvedActions = await db.prepare(`
    SELECT tipo, count(*) as count 
    FROM acoes_formativas 
    WHERE user_id = ? AND status = 'aprovado'
    GROUP BY tipo
  `).all(userId);

  // 3. Get total approved hours
  const totalHoursRow = await db.prepare(`
    SELECT COALESCE(SUM(carga_horaria), 0) as total_hours
    FROM acoes_formativas
    WHERE user_id = ? AND status = 'aprovado'
  `).get(userId);
  const totalHours = totalHoursRow ? Number(totalHoursRow.total_hours) : 0;

  // 4. Get count of distinct approved types
  const distinctTypesRow = await db.prepare(`
    SELECT COUNT(DISTINCT tipo) as distinct_types
    FROM acoes_formativas
    WHERE user_id = ? AND status = 'aprovado'
  `).get(userId);
  const distinctTypes = distinctTypesRow ? Number(distinctTypesRow.distinct_types) : 0;

  // 5. Get count of approved certifications
  const certCountRow = await db.prepare(`
    SELECT COUNT(*) as count
    FROM acoes_formativas
    WHERE user_id = ? AND status = 'aprovado' AND (tipo = 'certificacao' OR tipo_producao = 'certificacao')
  `).get(userId);
  const certCount = certCountRow ? Number(certCountRow.count) : 0;

  // 6. Get unawarded badges
  const unawardedBadges = await db.prepare(`
    SELECT id, requirement_type, requirement_value 
    FROM badges 
    WHERE id NOT IN (SELECT badge_id FROM user_badges WHERE user_id = ?)
  `).all(userId);

  for (const badge of unawardedBadges) {
    const { id, requirement_type, requirement_value } = badge;
    let earned = false;

    switch (requirement_type) {
      case 'level':
        if (stats.level >= requirement_value) earned = true;
        break;
      case 'xp':
        if (stats.xp >= requirement_value) earned = true;
        break;
      case 'streak':
        if ((stats.streak || 0) >= requirement_value) earned = true;
        break;
      case 'hours':
        if (totalHours >= requirement_value) earned = true;
        break;
      case 'types':
        if (distinctTypes >= requirement_value) earned = true;
        break;
      case 'certificacao':
        if (certCount >= requirement_value) earned = true;
        break;
      case 'curso':
      case 'evento':
      case 'producao': {
        const cnt = approvedActions.find(a => a.tipo === requirement_type)?.count || 0;
        if (cnt >= requirement_value) earned = true;
        break;
      }
    }

    if (earned) {
      await awardBadge(userId, id);
    }
  }
}

/**
 * Get leaderboard data ranked by XP
 * @returns {Promise<Array>} List of top users with rank, xp, level, avatar
 */
async function getLeaderboard() {
  const db = getDb();
  const rows = await db.prepare(`
    SELECT u.id, u.name, u.avatar_url as avatar, COALESCE(g.xp, 0) as xp, COALESCE(g.level, 1) as level
    FROM users u
    LEFT JOIN user_gamification g ON u.id = g.user_id
    ORDER BY xp DESC, u.name ASC
    LIMIT 100
  `).all();

  return rows.map((row, index) => ({
    ...row,
    rank: index + 1
  }));
}

/**
 * Get all available badges
 * @returns {Promise<Array>} List of all badges
 */
async function getAllBadges() {
  const db = getDb();
  return await db.prepare('SELECT * FROM badges ORDER BY id ASC').all();
}

module.exports = {
  getGamification,
  getLeaderboard,
  awardXP,
  awardBadge,
  checkActionBadges,
  getAllBadges
};
