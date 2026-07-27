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
 * Check and award action-based badges
 * @param {number} userId 
 */
async function checkActionBadges(userId) {
  const db = getDb();
  
  // Get counts of approved actions by type
  const approvedActions = await db.prepare(`
    SELECT tipo, count(*) as count 
    FROM acoes_formativas 
    WHERE user_id = ? AND status = 'aprovado'
    GROUP BY tipo
  `).all(userId);

  // Get unawarded action badges
  const unawardedActionBadges = await db.prepare(`
    SELECT id, requirement_type, requirement_value FROM badges 
    WHERE requirement_type IN ('curso', 'evento', 'producao')
      AND id NOT IN (SELECT badge_id FROM user_badges WHERE user_id = ?)
  `).all(userId);

  for (const badge of unawardedActionBadges) {
    const actionType = badge.requirement_type;
    const requiredCount = badge.requirement_value;
    const actionCount = approvedActions.find(a => a.tipo === actionType)?.count || 0;
    
    // If the user has at least requiredCount approved actions of this type, award the badge
    if (actionCount >= requiredCount) {
      await awardBadge(userId, badge.id);
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

module.exports = {
  getGamification,
  getLeaderboard,
  awardXP,
  awardBadge,
  checkActionBadges
};
