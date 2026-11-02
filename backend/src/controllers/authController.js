const config = require('../config');
const supabaseService = require('../services/supabaseService');
const listenerSettings = require('../services/audio/listenerSettings');
const logger = require('../utils/logger');

/**
 * Register a new user
 */
const register = async (req, res) => {
  try {
    const { email, password, display_name } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required'
      });
    }

    // Use Supabase Admin API to create user
    const { data, error } = await supabaseService.supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email in development
      user_metadata: {
        display_name: display_name || email.split('@')[0]
      }
    });

    if (error) {
      logger.error('Registration error:', error);
      return res.status(400).json({
        error: error.message
      });
    }

    // Create user profile
    const userId = data.user.id;
    try {
      await supabaseService.createUserProfile(userId, {
        display_name: display_name || email.split('@')[0],
        email: email
      });
    } catch (profileError) {
      logger.warn('Failed to create user profile:', profileError);
      // Continue anyway, profile can be created later
    }

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: {
        id: data.user.id,
        email: data.user.email,
        display_name: display_name || email.split('@')[0]
      }
    });

  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({
      error: 'Registration failed'
    });
  }
};

/**
 * Login user and return session
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required'
      });
    }

    // Use Supabase to sign in user
    const { data, error } = await supabaseService.supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      logger.error('Login error:', error);
      return res.status(401).json({
        error: error.message
      });
    }

    // Get user profile
    let userProfile = null;
    try {
      userProfile = await supabaseService.getUserProfile(data.user.id);
    } catch (profileError) {
      logger.warn('Failed to fetch user profile:', profileError);
    }

    res.json({
      success: true,
      user: {
        id: data.user.id,
        email: data.user.email,
        display_name: userProfile?.display_name || email.split('@')[0],
        profile: userProfile
      },
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at
      }
    });

  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      error: 'Login failed'
    });
  }
};

/**
 * Refresh user session
 */
const refreshSession = async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({
        error: 'Refresh token is required'
      });
    }

    const { data, error } = await supabaseService.supabase.auth.refreshSession({
      refresh_token
    });

    if (error) {
      logger.error('Session refresh error:', error);
      return res.status(401).json({
        error: error.message
      });
    }

    res.json({
      success: true,
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at
      }
    });

  } catch (error) {
    logger.error('Session refresh error:', error);
    res.status(500).json({
      error: 'Session refresh failed'
    });
  }
};

/**
 * Logout user
 */
const logout = async (req, res) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      // Sign out user with token
      await supabaseService.supabase.auth.admin.signOut(token);
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    logger.error('Logout error:', error);
    // Even if logout fails, return success to clear client state
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  }
};

/**
 * Get current user profile
 */
const getProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const userProfile = await supabaseService.getUserProfile(userId);
    
    res.json({
      success: true,
      user: {
        id: userId,
        email: req.user.email,
        display_name: userProfile?.display_name || req.user.email?.split('@')[0],
        listenPagesAhead: listenerSettings.isPagesAhead(userProfile?.listen_pages_ahead)
          ? userProfile.listen_pages_ahead
          : config.audio.pagesAhead,
        profile: userProfile
      }
    });

  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({
      error: 'Failed to fetch profile'
    });
  }
};

/**
 * Update the current user's settings. Only listenPagesAhead (1-5) for now.
 */
const updateProfile = async (req, res) => {
  try {
    const { listenPagesAhead } = req.body || {};
    if (!listenerSettings.isPagesAhead(listenPagesAhead)) {
      return res.status(400).json({
        error: 'INVALID_PAGES_AHEAD',
        message: `listenPagesAhead must be a whole number from ${listenerSettings.PAGES_AHEAD_MIN} to ${listenerSettings.PAGES_AHEAD_MAX}.`
      });
    }

    await supabaseService.setListenPagesAhead(req.user.id, listenPagesAhead);
    res.json({ success: true, listenPagesAhead });

  } catch (error) {
    logger.error('Update profile error:', error);
    res.status(500).json({
      error: 'Failed to update profile'
    });
  }
};

/**
 * Reset password
 */
const resetPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Email is required'
      });
    }

    const { error } = await supabaseService.supabase.auth.resetPasswordForEmail(
      email,
      {
        redirectTo: `${req.get('origin') || 'http://localhost:5173'}/reset-password`
      }
    );

    if (error) {
      logger.error('Password reset error:', error);
      return res.status(400).json({
        error: error.message
      });
    }

    res.json({
      success: true,
      message: 'Password reset email sent'
    });

  } catch (error) {
    logger.error('Password reset error:', error);
    res.status(500).json({
      error: 'Password reset failed'
    });
  }
};

module.exports = {
  register,
  login,
  refreshSession,
  logout,
  getProfile,
  updateProfile,
  resetPassword
};
