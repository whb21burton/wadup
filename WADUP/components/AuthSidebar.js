import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabase';
import { VENUE_CATEGORIES } from '../lib/data';
import { getAdminRole } from '../lib/admin';

const emptyLogin  = { email: '', password: '' };
const emptyUser   = { username: '', email: '', password: '', confirm: '', phone: '', city: '' };
const emptyVenue  = { businessName: '', email: '', password: '', confirm: '', phone: '', category: VENUE_CATEGORIES[0].id, city: '' };

export default function AuthSidebar({ open, onClose, session, profile }) {
  const [authTab,          setAuthTab]          = useState('login');   // 'login' | 'signup'
  const [signupAccountType,setSignupAccountType] = useState('user');   // 'user' | 'venue_owner'
  const [loginForm,        setLoginForm]        = useState(emptyLogin);
  const [userForm,         setUserForm]         = useState(emptyUser);
  const [venueForm,        setVenueForm]        = useState(emptyVenue);
  const [authError,        setAuthError]        = useState('');
  const [authInfo,         setAuthInfo]         = useState('');
  const [authLoading,      setAuthLoading]      = useState(false);
  const [adminRole,        setAdminRole]        = useState(null);

  // Only shows the ⚙️ Admin link for users with an admin_roles entry —
  // everyone else never even sees the link exists.
  useEffect(() => {
    if (!session?.user) {
      console.log('[admin] AuthSidebar: no session, clearing adminRole');
      setAdminRole(null);
      return;
    }
    let cancelled = false;
    getAdminRole(supabase, session.user.id).then(role => {
      console.log('[admin] AuthSidebar: adminRole resolved to', role);
      if (!cancelled) setAdminRole(role);
    });
    return () => { cancelled = true; };
  }, [session]);

  const switchTab = (tab) => {
    setAuthTab(tab);
    setAuthError('');
    setAuthInfo('');
  };

  const onLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthInfo('');
    setAuthLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: loginForm.email,
      password: loginForm.password,
    });
    setAuthLoading(false);
    if (error) { setAuthError(error.message); return; }
    setLoginForm(emptyLogin);
  };

  const onForgotPassword = async () => {
    setAuthError('');
    setAuthInfo('');
    if (!loginForm.email) {
      setAuthError('Enter your email above, then tap "Forgot password?"');
      return;
    }
    setAuthLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(loginForm.email, {
      redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
    });
    setAuthLoading(false);
    if (error) setAuthError(error.message);
    else setAuthInfo('Password reset email sent — check your inbox.');
  };

  const onSignupUser = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthInfo('');
    if (userForm.password !== userForm.confirm) {
      setAuthError('Passwords do not match.');
      return;
    }
    setAuthLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: userForm.email,
      password: userForm.password,
      options: {
        data: {
          account_type: 'user',
          username: userForm.username,
          phone: userForm.phone,
          city: userForm.city,
        },
      },
    });
    setAuthLoading(false);
    if (error) { setAuthError(error.message); return; }
    setUserForm(emptyUser);
    if (!data.session) {
      setAuthInfo('Account created — check your email to confirm, then log in.');
      setAuthTab('login');
    }
  };

  const onSignupVenue = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthInfo('');
    if (venueForm.password !== venueForm.confirm) {
      setAuthError('Passwords do not match.');
      return;
    }
    setAuthLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: venueForm.email,
      password: venueForm.password,
      options: {
        data: {
          account_type: 'venue_owner',
          business_name: venueForm.businessName,
          business_category: venueForm.category,
          phone: venueForm.phone,
          city: venueForm.city,
        },
      },
    });
    setAuthLoading(false);
    if (error) { setAuthError(error.message); return; }
    setVenueForm(emptyVenue);
    if (!data.session) {
      setAuthInfo('Account created — check your email to confirm, then log in.');
      setAuthTab('login');
    }
  };

  const onLogout = async () => {
    setAuthError('');
    setAuthInfo('');
    await supabase.auth.signOut();
  };

  return (
    <>
      {open && <div className="right-sidebar-backdrop" onClick={onClose} />}
      <aside className={`right-sidebar${open ? ' open' : ''}`}>
        <div className="right-sidebar-header">
          <span className="right-sidebar-title">Account</span>
          <button className="right-sidebar-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="right-sidebar-body">
          {session ? (
            profile ? (
              <div className="profile-card">
                <div className="profile-avatar">{(profile.username || '?').slice(0, 1).toUpperCase()}</div>
                <div className="profile-username">{profile.username}</div>
                <div className="profile-stats">
                  <div className="profile-stat">
                    <span className="profile-stat-label">WadUp Points</span>
                    <span className="profile-stat-value">{profile.wadup_points ?? 0}</span>
                  </div>
                  <div className="profile-stat">
                    <span className="profile-stat-label">Local City</span>
                    <span className="profile-stat-value">{profile.city || '—'}</span>
                  </div>
                  <div className="profile-stat">
                    <span className="profile-stat-label">Account Type</span>
                    <span className="profile-stat-value">
                      {profile.account_type === 'venue_owner' ? 'Venue Owner' : 'User'}
                    </span>
                  </div>
                </div>

                <div className="profile-quick-links">
                  <Link href={`/profile/${profile.username}`} className="profile-quick-link" onClick={onClose}>
                    👤 My Profile
                  </Link>
                  <Link href={`/profile/${profile.username}?tab=reviews`} className="profile-quick-link" onClick={onClose}>
                    ✍️ My Reviews
                  </Link>
                  <Link href={`/profile/${profile.username}?tab=saved`} className="profile-quick-link" onClick={onClose}>
                    ☆ Saved Places
                  </Link>
                  <Link href="/leaderboard" className="profile-quick-link" onClick={onClose}>
                    🏆 Leaderboard
                  </Link>
                  <Link href="/settings" className="profile-quick-link" onClick={onClose}>
                    ⚙️ Settings
                  </Link>
                  {adminRole && (
                    <Link href="/admin" className="profile-quick-link admin-quick-link-subtle" onClick={onClose}>
                      ⚙️ Admin
                    </Link>
                  )}
                </div>

                <button className="auth-submit logout-btn" onClick={onLogout}>Log Out</button>
              </div>
            ) : (
              <div className="profile-loading">Loading profile…</div>
            )
          ) : (
            <>
              <div className="auth-tabs">
                <button
                  className={`auth-tab${authTab === 'login' ? ' active' : ''}`}
                  onClick={() => switchTab('login')}
                >
                  Log In
                </button>
                <button
                  className={`auth-tab${authTab === 'signup' ? ' active' : ''}`}
                  onClick={() => switchTab('signup')}
                >
                  Create Account
                </button>
              </div>

              {authError && <div className="auth-error">{authError}</div>}
              {authInfo && <div className="auth-info">{authInfo}</div>}

              {authTab === 'login' ? (
                <form className="auth-form" onSubmit={onLogin}>
                  <label>Email</label>
                  <input
                    type="email" required autoComplete="email"
                    value={loginForm.email}
                    onChange={(e) => setLoginForm(f => ({ ...f, email: e.target.value }))}
                  />
                  <label>Password</label>
                  <input
                    type="password" required autoComplete="current-password"
                    value={loginForm.password}
                    onChange={(e) => setLoginForm(f => ({ ...f, password: e.target.value }))}
                  />
                  <button type="submit" className="auth-submit" disabled={authLoading}>
                    {authLoading ? 'Logging in…' : 'Log In'}
                  </button>
                  <button type="button" className="auth-link" onClick={onForgotPassword}>
                    Forgot password?
                  </button>
                </form>
              ) : (
                <>
                  <div className="account-type-toggle">
                    <button
                      className={`account-type-btn${signupAccountType === 'user' ? ' active' : ''}`}
                      onClick={() => setSignupAccountType('user')}
                    >
                      User
                    </button>
                    <button
                      className={`account-type-btn${signupAccountType === 'venue_owner' ? ' active' : ''}`}
                      onClick={() => setSignupAccountType('venue_owner')}
                    >
                      Business
                    </button>
                  </div>

                  {signupAccountType === 'user' ? (
                    <form className="auth-form" onSubmit={onSignupUser}>
                      <label>Username</label>
                      <input
                        type="text" required
                        value={userForm.username}
                        onChange={(e) => setUserForm(f => ({ ...f, username: e.target.value }))}
                      />
                      <label>Email</label>
                      <input
                        type="email" required autoComplete="email"
                        value={userForm.email}
                        onChange={(e) => setUserForm(f => ({ ...f, email: e.target.value }))}
                      />
                      <label>Password</label>
                      <input
                        type="password" required autoComplete="new-password"
                        value={userForm.password}
                        onChange={(e) => setUserForm(f => ({ ...f, password: e.target.value }))}
                      />
                      <label>Confirm Password</label>
                      <input
                        type="password" required autoComplete="new-password"
                        value={userForm.confirm}
                        onChange={(e) => setUserForm(f => ({ ...f, confirm: e.target.value }))}
                      />
                      <label>Phone Number</label>
                      <input
                        type="tel" required
                        value={userForm.phone}
                        onChange={(e) => setUserForm(f => ({ ...f, phone: e.target.value }))}
                      />
                      <label>City</label>
                      <input
                        type="text" required placeholder="This becomes your local city"
                        value={userForm.city}
                        onChange={(e) => setUserForm(f => ({ ...f, city: e.target.value }))}
                      />
                      <button type="submit" className="auth-submit" disabled={authLoading}>
                        {authLoading ? 'Creating account…' : 'Create Account'}
                      </button>
                    </form>
                  ) : (
                    <form className="auth-form" onSubmit={onSignupVenue}>
                      <label>Business Name</label>
                      <input
                        type="text" required
                        value={venueForm.businessName}
                        onChange={(e) => setVenueForm(f => ({ ...f, businessName: e.target.value }))}
                      />
                      <label>Email</label>
                      <input
                        type="email" required autoComplete="email"
                        value={venueForm.email}
                        onChange={(e) => setVenueForm(f => ({ ...f, email: e.target.value }))}
                      />
                      <label>Password</label>
                      <input
                        type="password" required autoComplete="new-password"
                        value={venueForm.password}
                        onChange={(e) => setVenueForm(f => ({ ...f, password: e.target.value }))}
                      />
                      <label>Confirm Password</label>
                      <input
                        type="password" required autoComplete="new-password"
                        value={venueForm.confirm}
                        onChange={(e) => setVenueForm(f => ({ ...f, confirm: e.target.value }))}
                      />
                      <label>Phone Number</label>
                      <input
                        type="tel" required
                        value={venueForm.phone}
                        onChange={(e) => setVenueForm(f => ({ ...f, phone: e.target.value }))}
                      />
                      <label>Business Category</label>
                      <select
                        value={venueForm.category}
                        onChange={(e) => setVenueForm(f => ({ ...f, category: e.target.value }))}
                      >
                        {VENUE_CATEGORIES.map(c => (
                          <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                      </select>
                      <label>City</label>
                      <input
                        type="text" required
                        value={venueForm.city}
                        onChange={(e) => setVenueForm(f => ({ ...f, city: e.target.value }))}
                      />
                      <button type="submit" className="auth-submit" disabled={authLoading}>
                        {authLoading ? 'Creating account…' : 'Create Account'}
                      </button>
                    </form>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
