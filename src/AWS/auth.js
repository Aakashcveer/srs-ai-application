import {
  signIn,
  confirmSignIn,
  fetchAuthSession,
  signOut,
} from "aws-amplify/auth";

/**
 * ============================
 * STEP 1: SEND EMAIL OTP
 * ============================
 */
export const sendOtp = async (email) => {
  try {
    console.log("sendOtp start:", email);

    // Clear stuck auth/challenge state
    try {
      await signOut();
    } catch (e) {}

    const res = await signIn({
      username: email,
      options: {
        authFlowType: "USER_AUTH",
        preferredChallenge: "EMAIL_OTP",
      },
    });

    console.log("sendOtp nextStep:", res?.nextStep);
    return res;
  } catch (err) {
    console.error("sendOtp failed:", err?.name, err?.message, err);
    throw err;
  }
};

/**
 * ============================
 * STEP 2: VERIFY OTP
 * ============================
 */
export const verifyOtp = async (code) => {
  try {
    const res = await confirmSignIn({
      challengeResponse: code,
    });

    try {
      const session = await fetchAuthSession();
      const idToken = session?.tokens?.idToken?.toString();
      if (idToken) {
        const payload = JSON.parse(atob(idToken.split(".")[1]));
        console.log("verifyOtp token claims:", payload);
      }
    } catch (e) {
      console.warn("verifyOtp: failed to inspect token claims", e);
    }

    return res;
  } catch (err) {
    console.error("verifyOtp failed:", err?.name, err?.message, err);
    throw err;
  }
};

/**
 * ============================
 * RESEND OTP
 * ============================
 */
export const resendOtp = async (email) => {
  try {
    if (!email) throw new Error("Email is required to resend OTP");

    try {
      await signOut();
    } catch (e) {}

    const res = await signIn({
      username: email,
      options: {
        authFlowType: "USER_AUTH",
        preferredChallenge: "EMAIL_OTP",
      },
    });

    console.log("resendOtp nextStep:", res?.nextStep);
    return res;
  } catch (err) {
    console.error("resendOtp failed:", err?.name, err?.message, err);
    throw err;
  }
};

/**
 * ============================
 * GET ACCESS TOKEN
 * ============================
 */
export const getAccessToken = async () => {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.accessToken?.toString() || null;
  } catch {
    return null;
  }
};

/**
 * ============================
 * GET USER PROFILE
 * ============================
 */
export const getUserProfile = async () => {
  try {
    const session = await fetchAuthSession();
    const idToken = session.tokens?.idToken?.toString();
    if (!idToken) return null;

    const payload = JSON.parse(atob(idToken.split(".")[1]));

    const resolvedProfile = String(
      payload.profile ||
        payload["custom:profile"] ||
        payload.role ||
        payload["custom:role"] ||
        ""
    )
      .trim();

    console.log("getUserProfile token claims:", payload);
    console.log("getUserProfile resolvedProfile:", resolvedProfile);

    return {
      email: payload.email,
      name: payload.name || payload.email,
      initial: (payload.name || payload.email || "U")[0].toUpperCase(),
      sub: payload.sub,

      profile: resolvedProfile,
      role: resolvedProfile.toLowerCase(),
    };
  } catch (err) {
    console.error("getUserProfile failed", err);
    return null;
  }
};

/**
 * ============================
 * LOGOUT
 * ============================
 */
export const logout = async () => {
  try {
    await signOut();
  } catch (err) {
    console.error("logout failed", err);
  } finally {
    try {
      localStorage.removeItem("isAuthenticated");
      localStorage.removeItem("chat-session-state");
      localStorage.removeItem("agentMode");
      sessionStorage.clear();
    } catch (e) {}
  }
};
