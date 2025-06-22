
interface OAuthVerificationResult {
  success: boolean;
  user: {
    id: string;
    name: string;
    username: string;
    email: string;
    avatar?: string;
    emailVerified: boolean;
    oAuthSignup: boolean;
    // ... other user fields
  };
  sessionToken: string;
  isNewUser: boolean;
  combinedSecret?: string;
}

// Main OAuth token verification function
export const verifyOAuthToken = async (token: string): Promise<OAuthVerificationResult> => {
  try {
    console.log('🔄 Verifying OAuth token with backend...');
    
    const response = await fetch('/api/auth/verify-oauth-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include', // Include cookies for session management
      body: JSON.stringify({ token })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
      console.error('❌ OAuth verification failed:', errorData);
      throw new Error(errorData.message || `HTTP ${response.status}: OAuth verification failed`);
    }

    const result: OAuthVerificationResult = await response.json();
    console.log('✅ OAuth verification successful:', {
      userId: result.user.id,
      email: result.user.email,
      isNewUser: result.isNewUser
    });
    
    return result;
    
  } catch (error) {
    console.error('🚨 OAuth token verification error:', error);
    throw error;
  }
};

// OAuth callback handler
export const handleOAuthCallback = async (): Promise<void> => {
  try {
    // Get token from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const error = urlParams.get('error');

    // Handle error cases
    if (error) {
      console.error('❌ OAuth error from URL:', error);
      throw new Error(`OAuth error: ${error}`);
    }

    if (!token) {
      console.error('❌ No OAuth token found in URL');
      throw new Error('No OAuth token provided');
    }

    console.log('🎫 Processing OAuth callback...');

    // Verify token with backend
    const result = await verifyOAuthToken(token);

    // Clean up URL (remove token from address bar)
    window.history.replaceState({}, document.title, window.location.pathname);

    // Handle successful authentication
    if (result.success && result.user) {
      console.log('✅ OAuth authentication successful');
      
      // Store user info in localStorage (optional)
      localStorage.setItem('user', JSON.stringify(result.user));
      
      // Redirect based on user type
      if (result.isNewUser) {
        console.log('🆕 New user - redirecting to onboarding');
        window.location.href = '/onboarding';
      } else {
        console.log('👤 Existing user - redirecting to dashboard');
        window.location.href = '/dashboard';
      }
    } else {
      throw new Error('Invalid authentication response');
    }
    
  } catch (error) {
    console.error('❌ OAuth callback failed:', error);
    
    // Clean up URL
    window.history.replaceState({}, document.title, window.location.pathname);
    
    // Redirect to login with error message
    const errorMessage = error instanceof Error ? error.message : 'OAuth authentication failed';
    window.location.href = `/auth/login?error=${encodeURIComponent(errorMessage)}`;
  }
};
