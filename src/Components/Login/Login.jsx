import React, { useState, useEffect, useRef } from "react";
import "./Login.css";
import { sendOtp, getAccessToken, verifyOtp, resendOtp } from "../../AWS/auth";

/* ── Particle canvas ── */
const ParticleBg = () => {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let animId;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);
    const particles = Array.from({ length: 60 }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: Math.random() * 1.5 + 0.4,
      dx: (Math.random() - 0.5) * 0.3,
      dy: (Math.random() - 0.5) * 0.3,
      alpha: Math.random() * 0.5 + 0.2,
    }));
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p) => {
        p.x += p.dx; p.y += p.dy;
        if (p.x < 0 || p.x > canvas.width) p.dx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.dy *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(30,203,133,${p.alpha})`;
        ctx.fill();
      });
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(30,203,133,${0.06 * (1 - dist / 120)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={canvasRef} className="dp-particle-canvas" />;
};

/* ── Wave SVG ── */
const WaveBg = () => (
  <svg className="dp-wave-bg" viewBox="0 0 1440 900" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
    <defs>
      <radialGradient id="wg1" cx="75%" cy="25%" r="50%">
        <stop offset="0%" stopColor="#00e5b0" stopOpacity="0.10"/>
        <stop offset="100%" stopColor="#00e5b0" stopOpacity="0"/>
      </radialGradient>
      <radialGradient id="wg2" cx="80%" cy="75%" r="40%">
        <stop offset="0%" stopColor="#00c8a0" stopOpacity="0.07"/>
        <stop offset="100%" stopColor="#00c8a0" stopOpacity="0"/>
      </radialGradient>
      <filter id="wblur"><feGaussianBlur stdDeviation="2.5"/></filter>
    </defs>
    <rect width="1440" height="900" fill="url(#wg1)"/>
    <rect width="1440" height="900" fill="url(#wg2)"/>
    <g opacity="0.55" filter="url(#wblur)">
      <path d="M200,60 Q400,140 600,100 Q800,60 1000,140 Q1200,200 1440,160" fill="none" stroke="#00e5b0" strokeWidth="1.5" opacity="0.7"/>
      <path d="M180,140 Q380,220 580,180 Q780,140 980,220 Q1180,280 1440,240" fill="none" stroke="#00d4a0" strokeWidth="1" opacity="0.6"/>
      <path d="M220,220 Q420,300 620,260 Q820,220 1020,300 Q1220,360 1440,320" fill="none" stroke="#00c890" strokeWidth="1.2" opacity="0.55"/>
      <path d="M190,300 Q390,380 590,340 Q790,300 990,380 Q1200,440 1440,400" fill="none" stroke="#00e5b0" strokeWidth="0.8" opacity="0.45"/>
      <path d="M210,380 Q410,460 610,420 Q810,380 1010,460 Q1220,520 1440,480" fill="none" stroke="#00d4a0" strokeWidth="1" opacity="0.4"/>
      <path d="M185,460 Q385,540 585,500 Q785,460 985,540 Q1200,600 1440,560" fill="none" stroke="#00c890" strokeWidth="0.8" opacity="0.35"/>
      <path d="M215,540 Q415,620 615,580 Q815,540 1015,620 Q1220,680 1440,640" fill="none" stroke="#00e5b0" strokeWidth="1" opacity="0.3"/>
      <path d="M190,620 Q390,700 590,660 Q790,620 990,700 Q1210,760 1440,720" fill="none" stroke="#00d4a0" strokeWidth="0.8" opacity="0.25"/>
    </g>
  </svg>
);

const ROLES = [
  { id: "engineer", label: "Engineer", icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>) },
  { id: "supplier", label: "Supplier", icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3"/><rect x="9" y="11" width="14" height="10" rx="1"/><path d="M17 11v-2a2 2 0 0 0-2-2h-1"/></svg>) },
  { id: "customer", label: "Customer", icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>) },
];

/* ── Card tilt on mouse move ── */
const useTilt = (ref) => {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleMove = (e) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const rotateX = ((y - cy) / cy) * -8;
      const rotateY = ((x - cx) / cx) * 8;
      el.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02,1.02,1.02)`;
    };
    const handleLeave = () => {
      el.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1,1,1)";
    };
    el.addEventListener("mousemove", handleMove);
    el.addEventListener("mouseleave", handleLeave);
    return () => {
      el.removeEventListener("mousemove", handleMove);
      el.removeEventListener("mouseleave", handleLeave);
    };
  }, []);
};

/* ── Minimal success overlay ── */
const CelebrationOverlay = () => (
  <div className="dp-celebration">
    <div className="dp-check-burst">
      <div className="dp-check-ring dp-check-ring-1" />
      <div className="dp-check-ring dp-check-ring-2" />
      <div className="dp-check-circle">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"
          strokeLinecap="round" strokeLinejoin="round" width="40" height="40">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
    </div>
    <p className="dp-celebration-text">Verified! Signing you in...</p>
  </div>
);

const Login = ({ onAuthenticate }) => {
  const [flipped, setFlipped] = useState(false);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const [showCelebration, setShowCelebration] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [selectedRole, setSelectedRole] = useState(null);
  const [shake, setShake] = useState(false);
  const emailRef = useRef(null);
  const btnRef = useRef(null);
  const verifyBtnRef = useRef(null);
  const otpInputs = useRef([]);

  // Countdown timer for resend
  useEffect(() => {
    if (!flipped) return; // only start when on OTP screen
    setCountdown(30);
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) { clearInterval(timer); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [flipped]);

  useEffect(() => {
    const checkSession = async () => {
      const flag = localStorage.getItem("isAuthenticated") === "true";
      if (!flag) return;
      const token = await getAccessToken();
      if (token) onAuthenticate();
    };
    checkSession();
  }, [onAuthenticate]);

  // Focus first OTP box after flip completes
  useEffect(() => {
    if (flipped) {
      setTimeout(() => otpInputs.current[0]?.focus(), 650);
    }
  }, [flipped]);

  const handleRipple = (e, ref) => {
    const btn = ref.current;
    if (!btn) return;
    const circle = document.createElement("span");
    const diameter = Math.max(btn.clientWidth, btn.clientHeight);
    const radius = diameter / 2;
    const rect = btn.getBoundingClientRect();
    circle.style.cssText = `
      width:${diameter}px;height:${diameter}px;
      left:${e.clientX - rect.left - radius}px;
      top:${e.clientY - rect.top - radius}px;
      position:absolute;border-radius:50%;
      background:rgba(255,255,255,0.35);
      transform:scale(0);animation:ripple 0.6s linear;
      pointer-events:none;
    `;
    btn.appendChild(circle);
    setTimeout(() => circle.remove(), 600);
  };

  const handleSendOtp = async (e) => {
    handleRipple(e, btnRef);
    if (!email.trim()) {
      setError("Email is required");
      setShake(true);
      setTimeout(() => setShake(false), 600);
      return;
    }
    setError("");
    setLoading(true);
    try {
      await sendOtp(email.trim());
      setFlipped(true); // ← FLIP the card!
    } catch (err) {
      setError(err?.message || "Failed to send OTP");
    }
    setLoading(false);
  };

  const handleOtpChange = (value, index) => {
    const finalValue = value.replace(/\D/g, "").slice(-1);
    const next = [...otp];
    next[index] = finalValue;
    setOtp(next);
    setError("");
    if (finalValue && index < otp.length - 1) otpInputs.current[index + 1]?.focus();
  };

  const handleBackspace = (e, index) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) otpInputs.current[index - 1]?.focus();
  };

  const handlePaste = (e) => {
    const data = e.clipboardData.getData("Text").trim();
    if (/^\d{8}$/.test(data)) {
      setOtp(data.split(""));
      setError("");
      otpInputs.current[7]?.focus();
    }
  };

  const handleVerify = async (e) => {
    handleRipple(e, verifyBtnRef);
    if (otp.join("").length !== 8) { setError("Please enter the full 8-digit OTP"); return; }
    setLoading(true);
    setError("");
    try {
      await verifyOtp(otp.join(""));
      localStorage.setItem("isAuthenticated", "true");
      setShowCelebration(true);
      setTimeout(() => {
        setShowCelebration(false);
        setExiting(true);
        setTimeout(() => onAuthenticate(), 600);
      }, 2000);
    } catch (err) {
      setError(err?.message || "Invalid OTP");
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resending || countdown > 0) return;
    setResending(true);
    setError("");
    setResent(false);
    try {
      await resendOtp();
      setResent(true);
      setCountdown(30); // reset countdown after resend
      setTimeout(() => setResent(false), 4000);
    } catch (err) {
      setError(err?.message || "Failed to resend OTP");
    }
    setResending(false);
  };

  const handleRoleClick = (roleId) => {
    setSelectedRole(roleId);
    setTimeout(() => emailRef.current?.focus(), 50);
  };

  const LeftPanel = () => (
    <section className="dp-left">
      <div className="dp-left-top">
        <div className="dp-logo">
          <div className="dp-logo-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="rgba(255,255,255,0.12)" />
              <polyline points="9 12 11 14 15 10" />
            </svg>
          </div>
          <span className="dp-logo-text">ASSURE-AI</span>
        </div>
      </div>

      <div className="dp-left-main">
        
       <h1 className="dp-headline">Compliance &amp; Assessment <span>Delivery Agents </span></h1>
        <p className="dp-eyebrow">Secure Collaboration. Autonomous Execution. Verifiable Trust.</p>
        

        <div className="dp-capability-list">
          {[
            ['fmd', 'FMD Reporting', 'file'],
            ['assessment', 'Flexible and Scalable AI Workforce', 'ai'],
            ['collaboration', 'Autonomous Collaboration & Task Management ', 'people'],
            ['visibility', 'Real-Time Visibility & Insights', 'chart'],
          ].map(([id, title, type]) => (
            <div className="dp-capability" key={id}>
              <div className="dp-capability-icon" aria-hidden="true">
                {type === 'file' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
                {type === 'ai' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12"/></svg>}
                {type === 'people' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>}
                {type === 'chart' && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="20" x2="6" y2="14"/><line x1="12" y1="20" x2="12" y2="8"/><line x1="18" y1="20" x2="18" y2="4"/></svg>}
              </div>
              <span>{title}</span>
            </div>
          ))}
        </div>
      </div>

      
    </section>
  );

  return (
    <div className={`dp-page${exiting ? " dp-page-exit" : ""}`}>
      <WaveBg />
      <ParticleBg />
      <div className="dp-layout">

        <LeftPanel />

        {/* Flipping card */}
        <div className="dp-right">
          <div className={`dp-card-flipper${flipped ? " dp-card-flipped" : ""}`}>

            {/* FRONT — Email */}
            <div className="dp-card-face dp-card-front dp-card-glow">
              <div className="dp-auth-brand">
                <div className="dp-auth-brand-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    <polyline points="9 12 11 14 15 10" />
                  </svg>
                </div>
                <div className="dp-auth-brand-copy">
                  <strong>ASSURE-AI</strong>
                  <span>Secure Workspace Access</span>
                </div>
              </div>

              <p className="dp-card-eyebrow">Welcome</p>
              <h2 className="dp-card-title">Sign in</h2>
              <p className="dp-card-sub"></p>

              <label className="dp-label">WORK EMAIL</label>
              <div className={`dp-input-wrap${shake ? " dp-shake" : ""}`}>
                <svg className="dp-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2"/>
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                </svg>
                <input
                  ref={emailRef}
                  type="email"
                  className="dp-input"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendOtp(e)}
                  autoFocus
                />
              </div>
              {error && <p className="dp-error">{error}</p>}

              <button
                ref={btnRef}
                className="dp-btn"
                onClick={handleSendOtp}
                disabled={loading}
                style={{ position: "relative", overflow: "hidden" }}
              >
                {loading ? <span className="dp-btn-loading"><span/><span/><span/></span> : "Send OTP"}
              </button>

              <div className="dp-divider">
                <div className="dp-divider-line"/>
                <span></span>
                <div className="dp-divider-line"/>
              </div>

              <div className="dp-roles">
                {ROLES.map((role) => (
                  <div
                    key={role.id}
                    className={`dp-role-flip${selectedRole === role.id ? " dp-role-flip--active" : ""}`}
                    onClick={() => handleRoleClick(role.id)}
                  >
                    <div className="dp-role-inner">
                      <div className="dp-role-front">
                        {role.icon}
                        <span>{role.label}</span>
                      </div>
                      <div className="dp-role-back">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        <span>{role.label}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="dp-auth-meta">
                <span>Encrypted access</span>
                <span>•</span>
                <span>Enterprise workspace</span>
              </div>

              <div className="dp-footer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
                <span>Secure passwordless authentication</span>
              </div>
            </div>

            {/* BACK — OTP */}
            <div className="dp-card-face dp-card-back dp-card-glow">
              <div className="dp-auth-brand">
                <div className="dp-auth-brand-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    <polyline points="9 12 11 14 15 10" />
                  </svg>
                </div>
                <div className="dp-auth-brand-copy">
                  <strong>ASSURE-AI</strong>
                  <span>Secure Workspace Access</span>
                </div>
              </div>

              <div className="dp-otp-success-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="#1ecb85" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="28" height="28">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
                </svg>
              </div>
              <p className="dp-card-eyebrow">Verification</p>
              <h2 className="dp-card-title">Check your inbox</h2>
              <p className="dp-card-sub">
                We sent an <span className="dp-digit-badge">8-digit</span> code to <span className="otp-email-highlight">{email}</span>
              </p>

              <label className="dp-label">ONE-TIME CODE</label>
              <div className="otp-container" onPaste={handlePaste}>
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    type="password"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    aria-label={`OTP digit ${i + 1}`}
                    className="otp-box"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(e.target.value, i)}
                    onKeyDown={(e) => { handleBackspace(e, i); if (e.key === "Enter") handleVerify(e); }}
                    ref={(el) => (otpInputs.current[i] = el)}
                  />
                ))}
              </div>

              {error && <p className="dp-error">{error}</p>}
              {resent && <p className="otp-resent-msg">✓ New code sent — check your inbox</p>}

              <button
                ref={verifyBtnRef}
                className="dp-btn"
                onClick={handleVerify}
                disabled={loading}
                style={{ position: "relative", overflow: "hidden" }}
              >
                {loading ? <span className="dp-btn-loading"><span/><span/><span/></span> : "Verify & sign in"}
              </button>

              <div className="otp-actions">
                <button
                  className={`otp-link-btn${countdown > 0 ? " otp-link-btn--disabled" : " otp-link-btn--active"}`}
                  onClick={handleResend}
                  disabled={resending || loading || countdown > 0}
                >
                  {resending ? "Resending…" : countdown > 0 ? (
                    <span className="otp-countdown">
                      Resend in <span className="otp-countdown-num">{countdown}s</span>
                    </span>
                  ) : "Resend code"}
                </button>
                <span className="otp-divider-dot">·</span>
                <button className="otp-link-btn" onClick={() => { setFlipped(false); setOtp(["","","","","","","",""]); setError(""); }} disabled={loading}>
                  ← Change email
                </button>
              </div>

              <div className="dp-footer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
                <span>Secure passwordless authentication</span>
              </div>
              {showCelebration && <CelebrationOverlay />}
            </div>

          </div>
        </div>

      </div>
    </div>
  );
};

export default Login;
