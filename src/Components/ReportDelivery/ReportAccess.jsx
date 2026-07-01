import React, { useEffect, useMemo, useState } from "react";
import {
  validateReportToken,
  sendReportOtp,
  verifyReportOtp,
  downloadCustomerReport,
  submitReportFeedback,
} from "../../api/api-config";
import "./ReportAccess.css";

const ReportAccess = () => {
  const [tokenStatus, setTokenStatus] = useState("LOADING");
  const [requestId, setRequestId] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  const [loadingMessage, setLoadingMessage] = useState("");
  const [error, setError] = useState("");

  const reportToken = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("token") || "";
  }, []);

  const setBusy = (message = "") => {
    setError("");
    setLoadingMessage(message);
  };

  const clearBusy = () => {
    setLoadingMessage("");
  };

  const formatDate = (value) => {
    if (!value) return "";
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  };

  useEffect(() => {
    const runValidate = async () => {
      if (!reportToken) {
        setTokenStatus("INVALID");
        setError("Report access token is missing from the link.");
        return;
      }

      try {
        setBusy("Validating secure report link...");
        const data = await validateReportToken(reportToken);

        setRequestId(data?.requestId || "");
        setMaskedEmail(data?.customerEmailMasked || "");
        setExpiresAt(data?.expiresAt || "");
        setTokenStatus(data?.tokenStatus || "LINK_OPENED");

        if (
          data?.tokenStatus === "OTP_VERIFIED" ||
          data?.tokenStatus === "DOWNLOADED" ||
          data?.tokenStatus === "FEEDBACK_SUBMITTED"
        ) {
          setOtpVerified(true);
        }

        if (
          data?.tokenStatus === "DOWNLOADED" ||
          data?.tokenStatus === "FEEDBACK_SUBMITTED"
        ) {
          setDownloaded(true);
        }

        if (data?.tokenStatus === "FEEDBACK_SUBMITTED") {
          setFeedbackSubmitted(true);
        }
      } catch (err) {
        setTokenStatus("INVALID");
        setError(err?.message || "Unable to validate report link.");
      } finally {
        clearBusy();
      }
    };

    runValidate();
  }, [reportToken]);

  const handleSendOtp = async () => {
    try {
      setBusy("Sending OTP to customer email...");
      const data = await sendReportOtp(reportToken);

      setOtpSent(true);
      setTokenStatus(data?.status || "OTP_SENT");

      if (data?.customerEmailMasked) {
        setMaskedEmail(data.customerEmailMasked);
      }
    } catch (err) {
      setError(err?.message || "Unable to send OTP.");
    } finally {
      clearBusy();
    }
  };

  const handleVerifyOtp = async () => {
    if (!otp.trim()) {
      setError("Please enter OTP.");
      return;
    }

    if (otp.trim().length !== 6) {
      setError("Please enter a valid 6 digit OTP.");
      return;
    }

    try {
      setBusy("Verifying OTP...");
      const data = await verifyReportOtp(reportToken, otp.trim());

      setOtpVerified(true);
      setTokenStatus(data?.status || "OTP_VERIFIED");

      if (data?.customerEmailMasked) {
        setMaskedEmail(data.customerEmailMasked);
      }
    } catch (err) {
      setError(err?.message || "Invalid OTP. Please try again.");
    } finally {
      clearBusy();
    }
  };

  const handleDownload = async () => {
    try {
      setBusy("Generating secure download link...");
      const data = await downloadCustomerReport(reportToken);

      setDownloaded(true);
      setTokenStatus(data?.status || "DOWNLOADED");

      if (data?.downloadUrl) {
        window.open(data.downloadUrl, "_blank", "noopener,noreferrer");
      } else {
        setError("Download URL missing from response.");
      }
    } catch (err) {
      setError(err?.message || "Unable to download report.");
    } finally {
      clearBusy();
    }
  };

  const handleSubmitFeedback = async () => {
    if (!rating) {
      setError("Please select rating.");
      return;
    }

    if (Number(rating) < 4 && !comment.trim()) {
      setError("Please add comment for rating less than 4.");
      return;
    }

    try {
      setBusy("Submitting feedback...");
      const data = await submitReportFeedback(
        reportToken,
        Number(rating),
        comment.trim()
      );

      setFeedbackSubmitted(true);
      setTokenStatus(data?.status || "FEEDBACK_SUBMITTED");
    } catch (err) {
      setError(err?.message || "Unable to submit feedback.");
    } finally {
      clearBusy();
    }
  };

  const isInvalid = tokenStatus === "INVALID";

  const getRatingLabel = (value) => {
    const labels = {
      5: "Excellent",
      4: "Good",
      3: "Average",
      2: "Poor",
      1: "Very Poor",
    };

    return labels[Number(value)] || "Select rating";
  };

  return (
    <div className="report-access-page">
      <div className="report-access-shell">
        <div className="report-brand">
          <div className="report-logo">A</div>
          <div>
            <h1>ASSURE-AI</h1>
            <p>Secure Report Delivery</p>
          </div>
        </div>

        <div className="report-card">
          <div className="report-card-header">
            <span className="report-badge">Customer Access</span>
            <h2>Download Your Assessment Report</h2>
            <p>
              Verify your email using OTP to securely access your report.
            </p>
          </div>

          {loadingMessage && (
            <div className="report-alert info">{loadingMessage}</div>
          )}

          {error && <div className="report-alert error">{error}</div>}

          {!isInvalid && (
            <div className="report-info-grid">
              <div>
                <label>Request ID</label>
                <strong>{requestId || "Loading..."}</strong>
              </div>

              <div>
                <label>Email</label>
                <strong>{maskedEmail || "Protected"}</strong>
              </div>

              <div>
                <label>Status</label>
                <strong>{tokenStatus}</strong>
              </div>

              <div>
                <label>Link Expiry</label>
                <strong>{formatDate(expiresAt) || "Not available"}</strong>
              </div>
            </div>
          )}

          {isInvalid ? (
            <div className="report-final-state">
              <h3>Unable to open report</h3>
              <p>
                This report link is invalid, expired, or missing required
                access details.
              </p>
            </div>
          ) : (
            <>
              {!otpVerified && (
                <div className="report-step">
                  <div className="report-step-number">1</div>
                  <div className="report-step-content">
                    <h3>Email OTP Verification</h3>
                    <p>
                      We will send a one-time password to your registered email.
                    </p>

                    <div className={`otp-flip-card ${otpSent ? "flipped" : ""}`}>
                      <div className="otp-flip-inner">
                        <div className="otp-flip-face otp-flip-front">
                          <div className="otp-visual-icon mail-icon">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M4 6.5h16v11H4v-11Z" />
                              <path d="M5 7l7 5.5L19 7" />
                            </svg>
                          </div>

                          <h4>Ready to verify your email?</h4>
                          <p>
                            We will send a secure one-time password to your
                            registered email.
                          </p>

                          <button
                            className="report-primary-btn"
                            onClick={handleSendOtp}
                            disabled={Boolean(loadingMessage)}
                          >
                            Send OTP
                          </button>
                        </div>

                        <div className="otp-flip-face otp-flip-back">
                          <div className="otp-visual-icon lock-icon">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M7.5 10V8a4.5 4.5 0 0 1 9 0v2" />
                              <path d="M6 10h12v9H6v-9Z" />
                              <path d="M12 14v2" />
                            </svg>
                          </div>

                          <h4>OTP sent successfully</h4>
                          <p>
                            Please enter the 6 digit OTP sent to your registered
                            email.
                          </p>

                          <div className="otp-box">
                            <input
                              type="text"
                              value={otp}
                              onChange={(e) =>
                                setOtp(e.target.value.replace(/\D/g, ""))
                              }
                              placeholder="Enter 6 digit OTP"
                              maxLength={6}
                              inputMode="numeric"
                              autoComplete="one-time-code"
                            />

                            <button
                              className="report-primary-btn"
                              onClick={handleVerifyOtp}
                              disabled={Boolean(loadingMessage)}
                            >
                              Verify OTP
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {otpVerified && !downloaded && (
                <div className="report-step">
                  <div className="report-step-number">2</div>
                  <div className="report-step-content">
                    <h3>Report Ready</h3>
                    <p>
                      OTP verified successfully. Your secure assessment report
                      is ready for download.
                    </p>

                    <div className="download-ready-card">
                      <div className="download-doc-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                          <path d="M7 3h7l4 4v14H7V3Z" />
                          <path d="M14 3v5h5" />
                          <path d="M9.5 13h5" />
                          <path d="M9.5 16h5" />
                        </svg>
                      </div>

                      <div className="download-doc-content">
                        <span className="download-eyebrow">Assessment Report</span>
                        <h4>PDF Document</h4>
                        <p>Secure link expires in 5 minutes.</p>
                      </div>

                      <button
                        className="report-primary-btn download-pulse-btn"
                        onClick={handleDownload}
                        disabled={Boolean(loadingMessage)}
                      >
                        Download Report
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {downloaded && !feedbackSubmitted && (
                <div className="report-step">
                  <div className="report-step-number">3</div>
                  <div className="report-step-content">
                    <h3>Feedback</h3>
                    <p>
                      Your report download link has been generated. Please share
                      your feedback.
                    </p>

                    <div className="feedback-box">
                      <div className="star-rating-section">
                        <label>Rating</label>

                        <div
                          className="star-rating"
                          role="radiogroup"
                          aria-label="Report experience rating"
                        >
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              type="button"
                              className={`star-btn ${
                                Number(rating) >= star ? "active" : ""
                              }`}
                              onClick={() => setRating(star)}
                              aria-label={`${star} star rating`}
                            >
                              ★
                            </button>
                          ))}
                        </div>

                        <div className="rating-copy">
                          <strong>{rating}/5</strong>
                          <span>{getRatingLabel(rating)}</span>
                        </div>
                      </div>

                      <label>Comment</label>
                      <textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="Write your feedback here..."
                        rows={4}
                      />

                      <button
                        className="report-primary-btn"
                        onClick={handleSubmitFeedback}
                        disabled={Boolean(loadingMessage)}
                      >
                        Submit Feedback
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {feedbackSubmitted && (
                <div className="report-final-state success">
                  <div className="success-check" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M5 12.5l4.2 4.2L19 7" />
                    </svg>
                  </div>

                  <h3>Thank you!</h3>
                  <p>
                    Your feedback has been submitted successfully. This report
                    delivery process is now complete.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <p className="report-footer">
          Powered by ASSURE-AI • Secure Sustainability Compliance Platform
        </p>
      </div>
    </div>
  );
};

export default ReportAccess;
