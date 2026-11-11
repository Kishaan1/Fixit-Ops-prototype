import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  Award,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Crown,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  Phone,
  Save,
  Shield,
  ShieldAlert,
  ShieldCheck,
  User as UserIcon,
  UserCheck,
  Wrench,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { api, errorMessage } from '../lib/api'
import type { UserProfileResponse } from '../lib/types'
import { Button, Field, Input, LoadingState } from '../components/ui'
import { AvatarUpload } from '../components/AvatarUpload'

export default function Profile() {
  const { user, updateUser, logout } = useAuth()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'VIEW' | 'EDIT' | 'PASSWORD' | 'EMAIL' | 'SECURITY'>('VIEW')

  // Fetch full profile and activity logs
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['my-profile'],
    queryFn: () => api.get<UserProfileResponse>('/auth/profile'),
  })

  const profile = data?.profile

  // Edit Profile Form State
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [userId, setUserId] = useState('')
  const [designation, setDesignation] = useState('')
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null)
  const [editSuccess, setEditSuccess] = useState('')
  const [editError, setEditError] = useState('')

  // Change Password State
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [passSuccess, setPassSuccess] = useState('')
  const [passError, setPassError] = useState('')

  // Change Email State
  const [newEmail, setNewEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [emailSuccess, setEmailSuccess] = useState('')
  const [emailError, setEmailError] = useState('')

  // Initialize edit form when profile is loaded
  const initEdit = () => {
    if (!profile) return
    setName(profile.name)
    setPhone(profile.phone || '')
    setUserId(profile.userId || '')
    setDesignation(profile.designation || '')
    setProfileImageUrl(profile.profileImageUrl)
    setEditSuccess('')
    setEditError('')
    setActiveTab('EDIT')
  }

  // Update Profile Mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (payload: {
      name: string
      phone: string
      userId?: string
      designation: string
      profileImageUrl: string | null
    }) => {
      return api.patch<{ user: any; message: string }>('/auth/profile', payload)
    },
    onSuccess: (res) => {
      updateUser(res.user)
      queryClient.invalidateQueries({ queryKey: ['my-profile'] })
      setEditSuccess(res.message || 'Profile updated successfully!')
      setEditError('')
    },
    onError: (err) => {
      setEditError(errorMessage(err))
    },
  })

  // Change Password Mutation
  const changePasswordMutation = useMutation({
    mutationFn: async (payload: { currentPassword: string; newPassword: string }) => {
      return api.post<{ ok: boolean; message: string }>('/auth/change-password', payload)
    },
    onSuccess: (res) => {
      setPassSuccess(res.message || 'Password changed successfully!')
      setPassError('')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmNewPassword('')
    },
    onError: (err) => {
      setPassError(errorMessage(err))
    },
  })

  // Change Email Mutation
  const changeEmailMutation = useMutation({
    mutationFn: async (payload: { newEmail: string; currentPassword: string }) => {
      return api.post<{ ok: boolean; email: string; message: string }>('/auth/change-email', payload)
    },
    onSuccess: (res) => {
      updateUser({ email: res.email })
      queryClient.invalidateQueries({ queryKey: ['my-profile'] })
      setEmailSuccess(res.message || 'Registered email updated successfully!')
      setEmailError('')
      setNewEmail('')
      setEmailPassword('')
    },
    onError: (err) => {
      setEmailError(errorMessage(err))
    },
  })

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setEditError('')
    setEditSuccess('')
    updateProfileMutation.mutate({
      name,
      phone,
      userId: userId.trim() || undefined,
      designation,
      profileImageUrl,
    })
  }

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setPassError('')
    setPassSuccess('')
    if (newPassword.length < 8) {
      setPassError('New password must be at least 8 characters long.')
      return
    }
    if (newPassword !== confirmNewPassword) {
      setPassError('New passwords do not match.')
      return
    }
    changePasswordMutation.mutate({
      currentPassword,
      newPassword,
    })
  }

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setEmailError('')
    setEmailSuccess('')
    if (!newEmail.includes('@')) {
      setEmailError('Please enter a valid email address.')
      return
    }
    changeEmailMutation.mutate({
      newEmail: newEmail.trim().toLowerCase(),
      currentPassword: emailPassword,
    })
  }

  if (isLoading) {
    return (
      <div className="surface p-12">
        <LoadingState label="Loading profile information..." />
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="surface p-8 text-center text-xs text-rose-600">
        Failed to load profile: {errorMessage(error)}
      </div>
    )
  }

  const isOwner = profile.role === 'OWNER'
  const initials = profile.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('')

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header Banner */}
      <div className="surface p-6 relative overflow-hidden">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 relative z-10">
          <div className="flex min-w-0 items-start gap-4">
            <div className="relative shrink-0">
              <div className="h-20 w-20 rounded-2xl overflow-hidden border-2 border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-2xl font-bold shadow-md">
                {profile.profileImageUrl ? (
                  <img
                    src={profile.profileImageUrl}
                    alt={profile.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-indigo-600 dark:text-indigo-400">{initials}</span>
                )}
              </div>
              <span
                className={`absolute -bottom-1 -right-1 h-5 w-5 rounded-full border-2 border-white dark:border-slate-900 flex items-center justify-center text-[10px] ${
                  profile.accountStatus === 'ACTIVE'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-rose-500 text-white'
                }`}
                title={`Status: ${profile.accountStatus}`}
              >
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="break-words text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {profile.name}
                </h1>
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold leading-tight ${
                    isOwner
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300'
                      : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-300'
                  }`}
                >
                  {isOwner ? <Crown className="h-3 w-3" /> : <Wrench className="h-3 w-3" />}
                  {isOwner ? 'Shop Owner' : 'Technician'}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {profile.designation || (isOwner ? 'Proprietor & Admin' : 'Diagnostic Specialist')}
              </p>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-2">
                <span className="font-mono bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded border border-slate-200 dark:border-white/10">
                  ID: {profile.userId || profile.id}
                </span>
                <span>•</span>
                <span>{profile.email}</span>
                {profile.phone && (
                  <>
                    <span>•</span>
                    <span>{profile.phone}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-stretch sm:self-auto">
            <Button
              variant={activeTab === 'EDIT' ? 'primary' : 'outline'}
              size="sm"
              onClick={initEdit}
              className="text-xs"
            >
              <UserCheck className="h-3.5 w-3.5 mr-1.5" />
              Edit Profile
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => logout()}
              className="text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20"
            >
              <LogOut className="h-3.5 w-3.5 mr-1.5" />
              Log Out
            </Button>
          </div>
        </div>

        {/* Technician Summary Stats Widget */}
        {!isOwner && profile.stats && (
          <div className="mt-6 pt-5 border-t border-slate-200/80 dark:border-white/10 grid grid-cols-3 gap-4">
            <div className="rounded-xl bg-slate-50 dark:bg-white/[0.02] p-3 text-center">
              <p className="text-xs text-slate-500">Total Assigned</p>
              <p className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                {profile.stats.totalAssigned}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-white/[0.02] p-3 text-center">
              <p className="text-xs text-slate-500">Repairs Completed</p>
              <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                {profile.stats.completedCount}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-white/[0.02] p-3 text-center">
              <p className="text-xs text-slate-500">Incentives Earned</p>
              <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400 mt-0.5">
                ₹{profile.stats.totalIncentives.toLocaleString()}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Profile Tabs Navigation */}
      <div className="flex p-1 bg-slate-200/70 dark:bg-slate-800/80 rounded-2xl gap-1 text-xs font-semibold overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('VIEW')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl transition shrink-0 ${
            activeTab === 'VIEW'
              ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <UserIcon className="h-3.5 w-3.5" /> Overview
        </button>

        <button
          type="button"
          onClick={initEdit}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl transition shrink-0 ${
            activeTab === 'EDIT'
              ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <UserCheck className="h-3.5 w-3.5" /> Edit Profile
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('PASSWORD')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl transition shrink-0 ${
            activeTab === 'PASSWORD'
              ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <KeyRound className="h-3.5 w-3.5" /> Change Password
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('EMAIL')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl transition shrink-0 ${
            activeTab === 'EMAIL'
              ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Mail className="h-3.5 w-3.5" /> Change Email
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('SECURITY')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl transition shrink-0 ${
            activeTab === 'SECURITY'
              ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Activity className="h-3.5 w-3.5" /> Account Activity Log
        </button>
      </div>

      {/* Tab 1: Overview */}
      {activeTab === 'VIEW' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="surface p-6 space-y-4">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-white/10 pb-2">
              Account Credentials &amp; Verification
            </h2>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-white/5">
                <span className="text-slate-500">Unique User ID</span>
                <span className="font-mono font-bold text-slate-900 dark:text-white">
                  {profile.userId || profile.id}
                </span>
              </div>

              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-white/5">
                <span className="text-slate-500">Email Address</span>
                <span className="font-medium text-slate-900 dark:text-white">{profile.email}</span>
              </div>

              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-white/5">
                <span className="text-slate-500">Email Verification</span>
                <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Verified
                </span>
              </div>

              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-white/5">
                <span className="text-slate-500">Contact Mobile</span>
                <span className="font-medium text-slate-900 dark:text-white">
                  {profile.phone || 'Not configured'}
                </span>
              </div>

              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-white/5">
                <span className="text-slate-500">Account Status</span>
                <span className="font-semibold text-emerald-600">{profile.accountStatus}</span>
              </div>

              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-white/5">
                <span className="text-slate-500">Designation</span>
                <span className="font-medium text-slate-900 dark:text-white">
                  {profile.designation || 'None'}
                </span>
              </div>
            </div>
          </div>

          <div className="surface p-6 space-y-4">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-white/10 pb-2">
              System Audit &amp; Metadata
            </h2>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-white/5">
                <span className="text-slate-500">Account Created</span>
                <span className="font-medium text-slate-900 dark:text-white">
                  {new Date(profile.createdAt).toLocaleDateString()}
                </span>
              </div>

              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-white/5">
                <span className="text-slate-500">Joining Date</span>
                <span className="font-medium text-slate-900 dark:text-white">
                  {profile.joiningDate ? new Date(profile.joiningDate).toLocaleDateString() : 'N/A'}
                </span>
              </div>

              <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-white/5">
                <span className="text-slate-500">Last Login Timestamp</span>
                <span className="font-medium text-slate-900 dark:text-white">
                  {profile.lastLogin ? new Date(profile.lastLogin).toLocaleString() : 'Active now'}
                </span>
              </div>

              {!isOwner && (
                <>
                  <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-white/5">
                    <span className="text-slate-500">Specialization</span>
                    <span className="font-medium text-slate-900 dark:text-white">
                      {profile.specialization || 'General diagnostics'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-white/5">
                    <span className="text-slate-500">Incentive Commission</span>
                    <span className="font-bold text-emerald-600">
                      {profile.incentiveRate ?? 10}%
                    </span>
                  </div>
                </>
              )}

              <div className="pt-2">
                <Button size="sm" variant="outline" className="w-full text-xs" onClick={initEdit}>
                  Update Profile Information
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Edit Profile */}
      {activeTab === 'EDIT' && (
        <div className="surface p-6 max-w-2xl">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-white/10 pb-3 mb-5">
            Edit Account Profile Details
          </h2>

          <form onSubmit={handleEditSubmit} className="space-y-4">
            {/* Avatar upload */}
            <AvatarUpload
              name={name}
              currentUrl={profileImageUrl}
              onChange={(url) => setProfileImageUrl(url)}
              label="Profile Photo (Upload file or snap from camera)"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Full Name" htmlFor="profile-name">
                <Input
                  id="profile-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>

              <Field label="Unique User ID" htmlFor="profile-userid">
                <Input
                  id="profile-userid"
                  required
                  value={userId}
                  onChange={(e) => setUserId(e.target.value.toUpperCase())}
                  placeholder="e.g. OWNER01 or TECH01"
                  className="font-mono uppercase"
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Contact Mobile Number" htmlFor="profile-phone">
                <Input
                  id="profile-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. 9876543210"
                />
              </Field>

              <Field label="Designation / Role" htmlFor="profile-desig">
                <Input
                  id="profile-desig"
                  value={designation}
                  onChange={(e) => setDesignation(e.target.value)}
                  placeholder="e.g. Senior Diagnostic Technician"
                />
              </Field>
            </div>

            {editError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                {editError}
              </div>
            )}

            {editSuccess && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                {editSuccess}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-white/10">
              <Button type="button" variant="outline" onClick={() => setActiveTab('VIEW')}>
                Cancel
              </Button>
              <Button type="submit" loading={updateProfileMutation.isPending}>
                <Save className="h-3.5 w-3.5 mr-1.5" /> Save Profile Details
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Tab 3: Change Password */}
      {activeTab === 'PASSWORD' && (
        <div className="surface p-6 max-w-xl">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-white/10 pb-3 mb-2">
            Change Account Password
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
            Passwords must contain at least 8 characters with at least one letter and one number.
          </p>

          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <Field label="Current Password" htmlFor="curr-pass">
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="curr-pass"
                  type={showPass ? 'text' : 'password'}
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password..."
                  className="pl-12 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-white"
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>

            <Field label="New Password" htmlFor="new-pass">
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="new-pass"
                  type={showPass ? 'text' : 'password'}
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password (min. 8 characters)..."
                  className="pl-12"
                />
              </div>
            </Field>

            <Field label="Confirm New Password" htmlFor="c-new-pass">
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="c-new-pass"
                  type={showPass ? 'text' : 'password'}
                  required
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder="Re-enter new password..."
                  className="pl-12"
                />
              </div>
            </Field>

            {passError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                {passError}
              </div>
            )}

            {passSuccess && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                {passSuccess}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-white/10">
              <Button type="submit" loading={changePasswordMutation.isPending}>
                Update Password
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Tab 4: Change Email */}
      {activeTab === 'EMAIL' && (
        <div className="surface p-6 max-w-xl">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-white/10 pb-3 mb-2">
            Change Registered Email Address
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
            Updating your registered email address requires confirmation of your current account password.
          </p>

          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10 text-xs">
              <span className="text-slate-500">Current Registered Email:</span>{' '}
              <span className="font-semibold text-slate-900 dark:text-white">{profile.email}</span>
            </div>

            <Field label="New Email Address" htmlFor="new-email">
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="new-email"
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="newemail@domain.com"
                  className="pl-12"
                />
              </div>
            </Field>

            <Field label="Confirm with Current Password" htmlFor="email-pass">
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="email-pass"
                  type="password"
                  required
                  value={emailPassword}
                  onChange={(e) => setEmailPassword(e.target.value)}
                  placeholder="Enter current password to verify..."
                  className="pl-12"
                />
              </div>
            </Field>

            {emailError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                {emailError}
              </div>
            )}

            {emailSuccess && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                {emailSuccess}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-white/10">
              <Button type="submit" loading={changeEmailMutation.isPending}>
                Verify &amp; Update Email
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Tab 5: Account Activity Log */}
      {activeTab === 'SECURITY' && (
        <div className="surface p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-white/10 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Account Security &amp; Activity Audit Log
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Timestamped security events, logins, and profile modifications recorded on the server.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetch()} title="Refresh logs">
              <Clock className="h-3.5 w-3.5 text-slate-400" />
            </Button>
          </div>

          {profile.activityLogs.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-8">
              No recent activity entries recorded.
            </p>
          ) : (
            <div className="space-y-2">
              {profile.activityLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start justify-between p-3 rounded-xl bg-slate-50/70 dark:bg-white/[0.02] border border-slate-200/70 dark:border-white/5 text-xs"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 h-2 w-2 rounded-full bg-indigo-500 shrink-0" />
                    <div>
                      <p className="font-semibold text-slate-800 dark:text-slate-200">
                        {log.activityType.replace(/_/g, ' ')}
                      </p>
                      <p className="text-slate-600 dark:text-slate-400 mt-0.5">
                        {log.activityDescription}
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0 ml-4">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {new Date(log.timestamp).toLocaleString()}
                    </p>
                    {log.ip && (
                      <p className="text-[10px] font-mono text-slate-400 mt-0.5">IP: {log.ip}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

