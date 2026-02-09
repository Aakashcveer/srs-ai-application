import React, { useState, useRef } from "react";
import "./Login.css";
import { verifyOtp, resendOtp } from "../../AWS/auth";

const OtpScreen = ({ email, onSuccess, onBack }) => {
  const [otp, setOtp] = useState(["", "", "", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const inputs = useRef([]);

  const handleChange = (value, index) => {
    if (value.length > 1) value = value.slice(-1);

    const next = [...otp];
    next[index] = value;
    setOtp(next);

    if (value && index < otp.length - 1) {
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
      inputs.current[7]?.focus();
    }
  };

  /* ===============================
     VERIFY OTP
  =============================== */
  const handleVerify = async () => {
    if (loading) return;
    setLoading(true);

    try {
      await verifyOtp(otp.join(""));
      localStorage.setItem("isAuthenticated", "true");
      onSuccess();
    } catch (err) {
      alert(err?.message || "Invalid OTP");
      setLoading(false);
    }
  };

  /* ===============================
     RESEND OTP
  =============================== */
  const handleResend = async () => {
    if (resending) return;
    setResending(true);

    try {
      await resendOtp();
      alert("OTP resent. Check inbox/spam.");
    } catch (err) {
      alert(err?.message || "Failed to resend OTP");
    }

    setResending(false);
  };

  return (
    <div className="login-page fade-in">
      <div className="login-card slide-up">
        <h1 className="login-title">Verify OTP</h1>
        <p className="login-sub">
          Enter the 8-digit OTP sent to <b>{email}</b>
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
              onKeyDown={(e) => handleBackspace(e, i)}
              ref={(el) => (inputs.current[i] = el)}
            />
          ))}
        </div>

        <button
          className="login-btn"
          onClick={handleVerify}
          disabled={loading}
        >
          {loading ? "Verifying..." : "Verify & Login"}
        </button>

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
    </div>
  );
};

export default OtpScreen;
