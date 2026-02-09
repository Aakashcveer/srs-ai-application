import {
  signIn,
  confirmSignIn,
  fetchAuthSession,
  signOut,
  // ❌ resendSignInCode,  // REMOVED (not supported in your Amplify build)
} from "aws-amplify/auth";

/**
 * ============================
 * STEP 1: SEND EMAIL OTP
 * ============================
 */
export const sendOtp = async (email) => {
  try {
    console.log("sendOtp start:", email);

    // ✅ Clear any stuck auth/challenge state
    try {
      await signOut(); // NOT global
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
    return await confirmSignIn({
      challengeResponse: code,
    });
  } catch (err) {
    console.error("verifyOtp failed:", err?.name, err?.message, err);
    throw err;
  }
};

/**
 * ============================
 * RESEND OTP ✅ FIXED
 * ============================
 * Amplify does not export resendSignInCode for this flow.
 * For EMAIL_OTP, calling signIn() again triggers a new OTP.
 *
 * IMPORTANT: you MUST pass the email again.
 */
export const resendOtp = async (email) => {
  try {
    if (!email) throw new Error("Email is required to resend OTP");

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

    return {
      email: payload.email,
      name: payload.name || payload.email,
      initial: (payload.name || payload.email)[0].toUpperCase(),
      sub: payload.sub,
    };
  } catch {
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
    localStorage.removeItem("isAuthenticated");
  } catch (err) {
    console.error("logout failed", err);
  }
};
