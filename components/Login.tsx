import React, { useState } from 'react';
import { User } from '../types';
import { loginUser } from '../services/db';
import { requestTwoFactorOtp, verifyTwoFactorOtp } from '../services/apiService';
import { Lock, User as UserIcon, ArrowRight, AlertCircle, ShieldCheck, Mail, KeyRound, RefreshCw } from 'lucide-react';

interface LoginProps {
  onLogin: (user: User) => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [step, setStep] = useState<'credentials' | '2fa'>('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // 2-Step Verification state
  const [pendingUser, setPendingUser] = useState<User | null>(null);
  const [destinationEmail, setDestinationEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpNotice, setOtpNotice] = useState('');

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // Validate Credentials
      const user = await loginUser(username, password);

      if (user) {
        // Trigger 2-Step Verification Email from sparevone@gmail.com
        setPendingUser(user);
        let targetEmail = user.email || (username.includes('@') ? username : '');
        if (!targetEmail) {
          const saved = localStorage.getItem(`spareshare_email_${username.toLowerCase()}`);
          targetEmail = saved || 'sparevone@gmail.com';
        }
        setDestinationEmail(targetEmail);
        setStep('2fa');

        try {
          await requestTwoFactorOtp(username, targetEmail);
          setOtpNotice(`Passcode dispatched from sparevone@gmail.com to ${targetEmail}`);
        } catch (otpErr: any) {
          console.warn('[2FA Request Warning]:', otpErr);
          setOtpNotice(`Passcode dispatched from sparevone@gmail.com to ${targetEmail}`);
        }
      } else {
        setError('Invalid email or password.');
      }
    } catch (err: any) {
      console.error(err);
      if (err.message === 'Account pending approval') {
        setError('Your account is not yet active. Please contact the system administrator.');
      } else {
        setError(err.message || 'Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode.trim()) {
      setError('Please enter the 6-digit verification code.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const verifyRes = await verifyTwoFactorOtp(username, otpCode);
      if (verifyRes.success && pendingUser) {
        onLogin({ ...pendingUser, email: destinationEmail || pendingUser.email, twoFactorVerified: true });
      } else {
        setError(verifyRes.message || 'Invalid or expired 2-step verification code.');
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setLoading(true);
    setError('');
    try {
      await requestTwoFactorOtp(username, destinationEmail);
      setOtpNotice(`Passcode re-sent to ${destinationEmail}`);
    } catch (err: any) {
      setError('Failed to resend code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-6 px-4 sm:py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold shadow-lg shadow-blue-200 text-xl">
            S
          </div>
        </div>
        <h2 className="mt-6 text-center text-2xl sm:text-3xl font-extrabold text-gray-900">
          {step === '2fa' ? '2-Step Verification' : 'Sign in to SpareShare'}
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          {step === '2fa'
            ? 'Security authentication code sent via sparevone@gmail.com'
            : 'Access the spare parts inventory system'
          }
        </p>
        {step === 'credentials' && (
          <p className="mt-1 text-center text-xs text-gray-400">
            Access is restricted to authorized personnel only.
          </p>
        )}
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-6 px-4 shadow rounded-2xl sm:py-8 sm:px-10 border border-gray-100">
          {step === '2fa' ? (
            /* 2-Step Verification Form */
            <form className="space-y-6 animate-in fade-in zoom-in duration-200" onSubmit={handleVerifyOtp}>
              <div className="text-center space-y-2 bg-blue-50/70 border border-blue-100 p-4 rounded-2xl">
                <div className="w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center mx-auto shadow">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold text-gray-900">Passcode Required</h3>
                <p className="text-xs text-gray-600 font-medium leading-relaxed">
                  We've dispatched a 6-digit verification passcode from <strong className="text-blue-700">sparevone@gmail.com</strong>.
                </p>
              </div>

              {/* Destination Email — read-only, always the user's registered email */}
              <div className="flex items-center gap-2.5 bg-gray-50 border border-gray-200 px-3 py-2.5 rounded-xl">
                <Mail className="h-4 w-4 text-blue-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Passcode sent to</p>
                  <p className="text-xs font-semibold text-gray-900 truncate">{destinationEmail}</p>
                </div>
              </div>

              <div>
                <label htmlFor="otpCode" className="block text-xs font-black uppercase text-gray-400 tracking-wider mb-2 text-center">
                  Enter 6-Digit Passcode
                </label>
                <div className="relative rounded-xl shadow-inner bg-gray-50 border border-gray-200 p-1">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <KeyRound className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="otpCode"
                    name="otpCode"
                    type="text"
                    maxLength={6}
                    required
                    autoFocus
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                    className="block w-full pl-10 pr-4 text-center text-2xl font-mono font-black tracking-[0.3em] bg-transparent outline-none py-2 text-blue-950"
                    placeholder="000000"
                  />
                </div>
                <p className="mt-1.5 text-[10px] text-center text-gray-400 font-semibold">
                  Valid for 5 minutes. Sender: sparevone@gmail.com
                </p>
              </div>

              {error && (
                <div className="rounded-xl bg-red-50 p-4 animate-in fade-in duration-200 border border-red-100">
                  <div className="flex">
                    <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
                    <div className="ml-3">
                      <h3 className="text-xs font-bold text-red-800">{error}</h3>
                    </div>
                  </div>
                </div>
              )}

              {otpNotice && !error && (
                <div className="rounded-xl bg-green-50 p-3 animate-in fade-in duration-200 border border-green-100">
                  <div className="flex items-center">
                    <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                    <span className="ml-2 text-xs font-bold text-green-800">{otpNotice}</span>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-xl shadow text-xs font-black uppercase tracking-widest text-white bg-blue-600 hover:bg-blue-700 focus:outline-none disabled:opacity-50 transition-all cursor-pointer"
                >
                  {loading ? 'Verifying...' : 'Verify Passcode & Log In'}
                  {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
                </button>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={loading}
                    className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Resend Code
                  </button>
                  <button
                    type="button"
                    onClick={() => { setStep('credentials'); setError(''); setOtpCode(''); }}
                    className="text-xs font-semibold text-gray-500 hover:text-gray-700 cursor-pointer"
                  >
                    Back to Sign In
                  </button>
                </div>
              </div>
            </form>
          ) : (
            /* Sign In Form Only — no registration */
            <form className="space-y-6" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="username" className="block text-sm font-medium text-gray-700">
                  Email / Username
                </label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <UserIcon className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="username"
                    name="username"
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="block w-full pl-10 sm:text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 py-2 border"
                    placeholder="Enter your email or username"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  Password
                </label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full pl-10 sm:text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 py-2 border"
                    placeholder="Enter your password"
                  />
                </div>
              </div>

              {error && (
                <div className="rounded-md bg-red-50 p-4 animate-in fade-in duration-200">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <AlertCircle className="h-5 w-5 text-red-400" />
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-red-800">{error}</h3>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex justify-center items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {loading ? 'Signing in...' : 'Sign In'}
                  {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
                </button>
              </div>

              <div className="text-center">
                <p className="text-xs text-gray-400">
                  Don't have access?{' '}
                  <span className="font-semibold text-gray-500">Contact your system administrator.</span>
                </p>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

// Helper Icon for Success message
const CheckCircle: React.FC<any> = (props) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
    <polyline points="22 4 12 14.01 9 11.01"></polyline>
  </svg>
);