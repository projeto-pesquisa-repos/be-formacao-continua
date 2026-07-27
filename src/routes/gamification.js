const express = require('express');
const router = express.Router();
const { getGamification, getLeaderboard } = require('../services/gamification');
const { auth } = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const data = await getGamification(req.user.id);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching gamification data:', error);
    res.status(500).json({ success: false, error: 'Erro ao buscar dados de gamificação' });
  }
});

router.get('/leaderboard', auth, async (req, res) => {
  try {
    const data = await getLeaderboard();
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ success: false, error: 'Erro ao buscar ranking do leaderboard' });
  }
});

module.exports = router;
