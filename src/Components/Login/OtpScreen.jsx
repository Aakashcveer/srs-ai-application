import React, { useState, useRef } from "react";
import "./Login.css";
import { verifyOtp, resendOtp } from "../../AWS/auth";

const OtpScreen = ({ email, onSuccess, onBack }) => {
  const [otp, setOtp] = useState(["", "", "", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");
  const inputs = useRef([]);

  const handleChange = (value, index) => {
    const onlyDigit = value.replace(/\D/g, "");
    const finalValue = onlyDigit.slice(-1);

    const next = [...otp];
    next[index] = finalValue;
    setOtp(next);
    setError("");

    if (finalValue && index < otp.length - 1) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleBackspace = (e, index) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    const data = e.clipboardData.getData("Text").trim();
    if (/^\d{8}$/.test(data)) {
      setOtp(data.split(""));
      setError("");
      inputs.current[7]?.focus();
    }
  };

  /* ===============================
     VERIFY OTP
  =============================== */
  const handleVerify = async () => {
    if (loading) return;

    if (otp.join("").length !== 8) {
      setError("Please enter the full 8-digit OTP");
      return;
    }

    setLoading(true);
    setError("");

    try {
      await verifyOtp(otp.join(""));
      localStorage.setItem("isAuthenticated", "true");
      onSuccess();
    } catch (err) {
      setError(err?.message || "Invalid OTP");
      setLoading(false);
    }
  };

  /* ===============================
     RESEND OTP
  =============================== */
  const handleResend = async () => {
    if (resending) return;
    setResending(true);
    setError("");

    try {
      await resendOtp();
      alert("OTP resent. Check inbox/spam.");
    } catch (err) {
      setError(err?.message || "Failed to resend OTP");
    }

    setResending(false);
  };

  return (
    <div className="login-page fade-in">
      <div className="login-card slide-up">
        <div className="brand-block">
          <h1 className="login-brand">SRS AI</h1>

        </div>

        <h2 className="login-title">Verify your email</h2>
        <p className="login-sub">
          Enter the 8-digit code sent to <b>{email}</b>
        </p>

        <div className="otp-container" onPaste={handlePaste}>
          {otp.map((digit, i) => (
            <input
              key={i}
              type="text"
              inputMode="numeric"
              className="otp-box"
              maxLength={1}
              value={digit}
              onChange={(e) => handleChange(e.target.value, i)}
              onKeyDown={(e) => {
                handleBackspace(e, i);
                if (e.key === "Enter") handleVerify();
              }}
              ref={(el) => (inputs.current[i] = el)}
            />
          ))}
        </div>

        {error && <p className="error-text">{error}</p>}

        <button
          className="login-btn"
          onClick={handleVerify}
          disabled={loading}
        >
          {loading ? "Verifying..." : "Verify & Login"}
        </button>

        <div className="otp-actions">
          <button
            className="back-btn"
            onClick={handleResend}
            disabled={loading || resending}
          >
            {resending ? "Resending..." : "Resend OTP"}
          </button>

          <button className="back-btn" onClick={onBack} disabled={loading}>
            ← Back
          </button>
        </div>

        <p className="footer-text">🔒 Secure passwordless authentication</p>
      </div>
    </div>
  );
};

export default OtpScreen;