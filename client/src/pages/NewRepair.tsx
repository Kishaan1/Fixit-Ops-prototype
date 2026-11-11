import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  ImagePlus,
  Info,
  Loader2,
  MapPin,
  Phone,
  Search,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  UserRound,
  Video,
  Wrench,
} from 'lucide-react'
import { api, errorMessage, fieldError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import type { AiStatus, CustomerDetail, Repair, Technician } from '../lib/types'
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
  cn,
} from '../components/ui'
import { money } from '../lib/format'
import { CameraCaptureModal } from '../components/CameraCaptureModal'
import { ComplaintInput } from '../components/ComplaintInput'
import { ImageDropzone, IMAGE_ACCEPT, IMAGE_FORMATS_LABEL, MAX_IMAGE_MB } from '../components/ImageDropzone'

const STEPS = [
  { id: 0, label: 'Customer', description: 'Who is it for?' },
  { id: 1, label: 'Device', description: 'What came in?' },
  { id: 2, label: 'Problem', description: 'What needs fixing?' },
]

const CATEGORIES = ['Smartphone', 'Laptop', 'Tablet', 'Keypad Phone', 'Other']

interface LookupResponse {
  customer: {
    id: string
    name: string
    phone: string
    email: string | null
    address: string | null
    notes: string | null
  } | null
  returning: boolean
  visits?: number
  completed?: number
  totalSpent?: number
  lastServiceDate?: string | null
}

interface IdentifyResult {
  category: string
  brand: string
  model: string
  generation: string
  color?: string
  confidence: number | null
  visibleDamage: string[]
  screenCondition: string
  bodyCondition: string
  missingComponents: string[]
  notes: string
  clarifyingQuestions: string[]
}

export default function NewRepair() {
  const { user } = useAuth()
  const { success, error } = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  // One key per intake form, so a double-click or retry cannot create a second
  // repair. It lives only in memory; nothing is persisted in the browser.
  const requestIdRef = useRef<string>('')
  if (!requestIdRef.current) {
    requestIdRef.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `intake-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  const [step, setStep] = useState(0)
  const [phone, setPhone] = useState('')
  const [lookupResult, setLookupResult] = useState<LookupResponse | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState<LookupResponse['customer']>(null)
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '', address: '' })
  const [device, setDevice] = useState({
    category: 'Smartphone',
    brand: '',
    model: '',
    imei: '',
    serialNumber: '',
    color: '',
    accessories: '',
    conditionNotes: '',
    imagePath: '',
  })
  const [problem, setProblem] = useState('')
  const [priority, setPriority] = useState('NORMAL')
  const [technicianId, setTechnicianId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [identifyResult, setIdentifyResult] = useState<IdentifyResult | null>(null)
  const [uploading, setUploading] = useState(false)
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false)
  const [uploadedOriginalName, setUploadedOriginalName] = useState('')
  const [cameraModalOpen, setCameraModalOpen] = useState(false)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const photoPreviewRef = useRef<string | null>(null)

  const setLocalPhotoPreview = (file: File) => {
    if (photoPreviewRef.current) URL.revokeObjectURL(photoPreviewRef.current)
    const url = URL.createObjectURL(file)
    photoPreviewRef.current = url
    setPhotoPreview(url)
  }

  const clearLocalPhotoPreview = () => {
    if (photoPreviewRef.current) {
      URL.revokeObjectURL(photoPreviewRef.current)
      photoPreviewRef.current = null
    }
    setPhotoPreview(null)
  }

  useEffect(() => {
    return () => {
      if (photoPreviewRef.current) URL.revokeObjectURL(photoPreviewRef.current)
    }
  }, [])

  const aiStatus = useQuery({
    queryKey: ['ai-status'],
    queryFn: () => api.get<AiStatus>('/ai/status'),
  })

  const technicians = useQuery({
    queryKey: ['technicians'],
    queryFn: () => api.get<{ items: Technician[] }>('/technicians'),
    enabled: user?.role === 'OWNER',
  })

  const lookup = useMutation({
    mutationFn: (value: string) =>
      api.get<LookupResponse>(`/customers/lookup?phone=${encodeURIComponent(value)}`),
    onSuccess: (result, value) => {
      setLookupResult(result)
      if (result.customer) {
        setSelectedCustomer(result.customer)
        setNewCustomer({ name: '', phone: '', email: '', address: '' })
      } else {
        setSelectedCustomer(null)
        setNewCustomer((current) => ({
          ...current,
          phone: value,
        }))
      }
    },
    onError: (err) => error('Lookup failed', errorMessage(err)),
  })

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ repair: Repair }>('/repairs', body),
    onSuccess: (result) => {
      success('Repair created', `${result.repair.code} is ready for the next step.`)
      void queryClient.invalidateQueries({ queryKey: ['repairs'] })
      navigate(`/repairs/${result.repair.id}`)
    },
    onError: (err) => setFormError(errorMessage(err)),
  })

  const effectivePhone = selectedCustomer?.phone ?? newCustomer.phone
  const customerReady = Boolean(selectedCustomer) || (newCustomer.name.trim().length >= 2 && newCustomer.phone.trim().length >= 7)
  const deviceReady = device.brand.trim().length > 0 && device.model.trim().length > 0
  const problemReady = problem.trim().length >= 5

  const goNext = () => {
    setFormError(null)
    if (step === 0 && !customerReady) {
      setFormError('Select a returning customer or enter a name and valid phone number.')
      return
    }
    if (step === 1 && !deviceReady) {
      setFormError('Enter at least the device brand and model.')
      return
    }
    setStep((current) => Math.min(2, current + 1))
  }

  const runAiAnalysis = async (customImagePath?: string, customOriginalName?: string) => {
    const targetImagePath = customImagePath || device.imagePath

    if (!targetImagePath) {
      error('No photo found', 'Capture or upload a device photo before asking AI to identify it.')
      return
    }

    if (!aiStatus.data?.configured) {
      error(
        'AI identification is not configured',
        'Enter the brand and model manually. No model or condition has been guessed.',
      )
      return
    }

    setAnalyzingPhoto(true)
    setFormError(null)
    try {
      const response = await api.post<{ result: IdentifyResult; disclaimer: string; isAiPowered: boolean }>(
        '/ai/identify',
        {
          imagePath: targetImagePath,
          originalName: customOriginalName || uploadedOriginalName || undefined,
        },
      )

      const res = response.result
      setIdentifyResult(res)

      // Fill only values returned by the provider. Nothing is inferred locally.
      setDevice((current) => ({
        ...current,
        category: CATEGORIES.includes(res.category) ? res.category : current.category,
        brand: res.brand || current.brand,
        model: res.model || current.model,
        color: res.color || current.color,
      }))

      success(
        'AI identification complete',
        res.model
          ? `Suggested ${res.brand} ${res.model}. Verify the model and condition before saving.`
          : 'The AI could not confirm a model. Enter it manually.',
      )
    } catch (err) {
      setIdentifyResult(null)
      error('AI identification unavailable', errorMessage(err))
    } finally {
      setAnalyzingPhoto(false)
    }
  }

  const uploadImage = async (file: File) => {
    setUploading(true)
    setFormError(null)
    setUploadedOriginalName(file.name)
    setLocalPhotoPreview(file)
    try {
      const result = await api.upload<{ filename: string; originalName?: string; url: string }>('/uploads', file)
      setDevice((current) => ({ ...current, imagePath: result.filename }))
      setUploadedOriginalName(result.originalName || file.name)
      if (aiStatus.data?.configured) {
        void runAiAnalysis(result.filename, result.originalName || file.name)
      } else {
        success('Photo attached', 'AI identification is not configured. Enter the brand and model manually.')
      }
    } catch (err) {
      error('Upload failed', errorMessage(err))
      clearLocalPhotoPreview()
    } finally {
      setUploading(false)
      clearLocalPhotoPreview()
    }
  }

  const reApplyAiDetails = () => {
    if (!identifyResult) return
    setDevice((current) => ({
      ...current,
      category: CATEGORIES.includes(identifyResult.category) ? identifyResult.category : current.category,
      brand: identifyResult.brand || current.brand,
      model: identifyResult.model || current.model,
      color: identifyResult.color || current.color,
    }))
    success('Details re-applied', 'AI suggestions were copied to category, brand, model and colour. Verify them before saving.')
  }

  const submit = () => {
    setFormError(null)
    if (create.isPending) return
    if (!customerReady) {
      setStep(0)
      setFormError('Customer details are incomplete.')
      return
    }
    if (!deviceReady) {
      setStep(1)
      setFormError('Device details are incomplete.')
      return
    }
    if (!problemReady) {
      setFormError('Describe the reported problem in a little more detail.')
      return
    }
    const body: Record<string, unknown> = {
      device: {
        ...device,
        imagePath: device.imagePath || undefined,
      },
      problem: problem.trim(),
      priority,
      technicianId: technicianId || null,
      clientRequestId: requestIdRef.current,
    }
    if (selectedCustomer) {
      body.customerId = selectedCustomer.id
    } else {
      body.customer = {
        name: newCustomer.name.trim(),
        phone: newCustomer.phone.trim(),
        email: newCustomer.email.trim(),
        address: newCustomer.address.trim(),
      }
    }
    create.mutate(body)
  }

  const summaryCustomer = selectedCustomer
    ? { name: selectedCustomer.name, phone: selectedCustomer.phone, returning: true }
    : customerReady
      ? { name: newCustomer.name, phone: newCustomer.phone, returning: false }
      : null

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Intake"
        title="Create a repair"
        description="Capture the customer, device and reported fault. You can add diagnostics, parts and quotes once the repair exists."
        actions={
          <Button variant="outline" icon={ArrowLeft} onClick={() => navigate('/repairs')}>
            Back to repairs
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {STEPS.map((item) => {
          const done = step > item.id
          const active = step === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (item.id <= step) setStep(item.id)
              }}
              className={cn(
                'flex items-center gap-3 rounded-2xl border p-3.5 text-left transition',
                active
                  ? 'border-indigo-300 bg-indigo-50/60 dark:border-indigo-500/40 dark:bg-indigo-500/10'
                  : done
                    ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-500/25 dark:bg-emerald-500/5'
                    : 'border-slate-200 bg-white dark:border-white/10 dark:bg-white/[0.02]',
              )}
            >
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                  active
                    ? 'bg-indigo-600 text-white'
                    : done
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400',
                )}
              >
                {done ? <Check className="h-4 w-4" /> : item.id + 1}
              </span>
              <div>
                <p className={cn('text-sm font-semibold', active ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-800 dark:text-slate-200')}>
                  {item.label}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{item.description}</p>
              </div>
            </button>
          )
        })}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        <Card>
          {step === 0 ? (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">Find the customer</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Search by phone number to recognise returning customers and keep their history together.
                </p>
              </div>

              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (phone.trim().length < 7) {
                    setFormError('Enter a valid phone number to search.')
                    return
                  }
                  setFormError(null)
                  lookup.mutate(phone.trim())
                }}
              >
                <div className="relative flex-1">
                  <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="Customer phone number"
                    className="pl-12"
                    inputMode="tel"
                  />
                </div>
                <Button type="submit" variant="secondary" icon={Search} loading={lookup.isPending}>
                  Look up
                </Button>
              </form>

              {lookupResult ? (
                <div className="rounded-2xl border border-slate-200 p-4 dark:border-white/10">
                  {lookupResult.customer ? (
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
                          <UserRound className="h-5 w-5" />
                        </span>
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-white">
                            {lookupResult.customer.name}
                          </p>
                          <p className="text-sm text-slate-500 dark:text-slate-400">
                            {lookupResult.customer.phone}
                            {lookupResult.customer.email ? ` · ${lookupResult.customer.email}` : ''}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <Badge tone="emerald" dot>
                              Returning customer
                            </Badge>
                            <Badge tone="slate">{lookupResult.visits ?? 0} visits</Badge>
                            <Badge tone="slate">{money(lookupResult.totalSpent ?? 0)} lifetime</Badge>
                          </div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={selectedCustomer ? 'success' : 'outline'}
                        icon={selectedCustomer ? CheckCircle2 : UserPlus}
                        onClick={() => {
                          setSelectedCustomer(lookupResult.customer)
                          setNewCustomer({ name: '', phone: '', email: '', address: '' })
                        }}
                      >
                        {selectedCustomer ? 'Selected' : 'Use customer'}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">No customer found</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          Add their details below to create a new customer record.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setNewCustomer((current) => ({ ...current, phone: phone.trim() }))
                        }
                      >
                        Prefill phone
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}

              <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-slate-400">
                <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
                or add a new customer
                <span className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name" required error={!selectedCustomer ? undefined : undefined}>
                  <Input
                    value={selectedCustomer ? selectedCustomer.name : newCustomer.name}
                    onChange={(event) => {
                      setSelectedCustomer(null)
                      setNewCustomer((current) => ({ ...current, name: event.target.value }))
                    }}
                    placeholder="e.g. Ananya Sharma"
                    disabled={Boolean(selectedCustomer)}
                  />
                </Field>
                <Field label="Phone" required>
                  <Input
                    value={selectedCustomer ? selectedCustomer.phone : newCustomer.phone}
                    onChange={(event) => {
                      setSelectedCustomer(null)
                      setNewCustomer((current) => ({ ...current, phone: event.target.value }))
                    }}
                    placeholder="10-digit mobile"
                    inputMode="tel"
                    disabled={Boolean(selectedCustomer)}
                  />
                </Field>
                <Field label="Email">
                  <Input
                    type="email"
                    value={selectedCustomer ? (selectedCustomer.email ?? '') : newCustomer.email}
                    onChange={(event) => {
                      setSelectedCustomer(null)
                      setNewCustomer((current) => ({ ...current, email: event.target.value }))
                    }}
                    placeholder="Optional"
                    disabled={Boolean(selectedCustomer)}
                  />
                </Field>
                <Field label="Address">
                  <Input
                    value={selectedCustomer ? (selectedCustomer.address ?? '') : newCustomer.address}
                    onChange={(event) => {
                      setSelectedCustomer(null)
                      setNewCustomer((current) => ({ ...current, address: event.target.value }))
                    }}
                    placeholder="Optional"
                    disabled={Boolean(selectedCustomer)}
                  />
                </Field>
              </div>

              {user?.role === 'OWNER' ? (
                <Field label="Assign technician" hint="You can change this later from the repair page.">
                  <Select value={technicianId} onChange={(event) => setTechnicianId(event.target.value)}>
                    <option value="">Leave unassigned</option>
                    {technicians.data?.items
                      .filter((tech) => tech.active)
                      .map((tech) => (
                        <option key={tech.id} value={tech.id}>
                          {tech.name}
                          {tech.specialization ? ` · ${tech.specialization}` : ''}
                        </option>
                      ))}
                  </Select>
                </Field>
              ) : null}

              {selectedCustomer ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCustomer(null)
                    setNewCustomer({ name: '', phone: effectivePhone, email: '', address: '' })
                  }}
                  className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  Use different details instead
                </button>
              ) : null}
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">Device details</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Record exactly what the customer handed over. A photo helps resolve disputes later.
                </p>
              </div>

              <div className="space-y-3">
                <ImageDropzone
                  onFile={uploadImage}
                  onError={(message) => error('Image not accepted', message)}
                  disabled={uploading || analyzingPhoto}
                  showError={false}
                  overlayLabel="Drop device photo here"
                  ariaLabel="Device photo upload. Drag and drop an image here, or click to browse."
                  className="overflow-hidden rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/50 dark:border-white/15 dark:bg-white/[0.02]"
                >
                  {photoPreview || device.imagePath ? (
                    <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                      <div className="relative h-40 w-full shrink-0 overflow-hidden rounded-xl ring-1 ring-slate-200 dark:ring-white/10 sm:h-32 sm:w-40">
                        <img
                          src={photoPreview || `/api/uploads/${device.imagePath}`}
                          alt="Device intake"
                          className="h-full w-full object-cover"
                        />
                        {uploading ? (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-950/55 text-white">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            <span className="text-[10px] font-semibold">Uploading…</span>
                          </div>
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Photo Attached</p>
                          <Badge tone="green">Attached</Badge>
                        </div>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Drag a new photo directly into this box, or use the buttons below to replace it.
                        </p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {aiStatus.data?.configured
                            ? 'AI can suggest the category, brand, model and visible condition. Every suggestion must be verified by the technician.'
                            : 'AI identification is not configured. The photo is stored with the intake record; enter the details manually.'}
                        </p>
                        <div
                          className="mt-3 flex flex-wrap items-center gap-2"
                          data-dropzone-ignore
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Button
                            size="sm"
                            icon={Sparkles}
                            onClick={() => void runAiAnalysis()}
                            loading={analyzingPhoto}
                            disabled={!aiStatus.data?.configured}
                            className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold shadow-xs"
                          >
                            {aiStatus.data?.configured
                              ? analyzingPhoto
                                ? 'AI Analysing Photo…'
                                : 'Suggest Details from Photo'
                              : 'AI Not Configured'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            icon={Camera}
                            onClick={() => setCameraModalOpen(true)}
                            loading={uploading || analyzingPhoto}
                          >
                            Retake / Replace
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={Trash2}
                            onClick={() => {
                              clearLocalPhotoPreview()
                              setDevice((current) => ({ ...current, imagePath: '' }))
                              setIdentifyResult(null)
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-3 px-4 py-8 text-center">
                      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-400">
                        {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                          {uploading ? 'Uploading device photo…' : 'Drag & Drop Device Photo Here'}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          Or <span className="font-semibold text-indigo-600 underline dark:text-indigo-400">Browse Files</span> — you can also use the camera.
                        </p>
                        <p className="mt-1 text-[11px] font-medium text-slate-400 dark:text-slate-500">
                          {IMAGE_FORMATS_LABEL} · Maximum {MAX_IMAGE_MB} MB
                        </p>
                        <p className="mx-auto mt-2 max-w-md text-xs text-slate-500 dark:text-slate-400">
                          {aiStatus.data?.configured
                            ? 'AI can suggest the category, brand, model and visible damage for you to verify.'
                            : 'AI identification is not configured. Attach a photo for the record and enter the model manually.'}
                        </p>
                      </div>
                      <div
                        className="flex flex-wrap items-center justify-center gap-2"
                        data-dropzone-ignore
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Button
                          icon={Camera}
                          onClick={() => setCameraModalOpen(true)}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-xs"
                        >
                          Capture Device
                        </Button>
                        <Button
                          variant="outline"
                          icon={Upload}
                          onClick={() => fileRef.current?.click()}
                        >
                          Upload from Files
                        </Button>
                      </div>
                    </div>
                  )}
                </ImageDropzone>
                <input
                  ref={fileRef}
                  type="file"
                  accept={IMAGE_ACCEPT}
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) void uploadImage(file)
                  }}
                />
              </div>

              {identifyResult ? (
                <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4 dark:border-violet-500/25 dark:bg-violet-500/[0.07] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-600 text-white shadow-xs">
                        <Sparkles className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                          {identifyResult.brand} {identifyResult.model}
                          <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                            ({identifyResult.category}{identifyResult.generation ? ` · ${identifyResult.generation}` : ''})
                          </span>
                        </p>
                        <p className="text-xs text-violet-700 dark:text-violet-300">
                          AI suggestion — verify the model and condition on the bench
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {typeof identifyResult.confidence === 'number' ? (
                        <Badge tone="violet">{identifyResult.confidence}% AI confidence</Badge>
                      ) : (
                        <Badge tone="slate">No confidence score</Badge>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={reApplyAiDetails}
                      >
                        Re-apply to Form
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-500/20">
                    <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span>Suggested values copied to Category, Brand, Model and Colour. Condition observations below are not saved automatically — confirm them on the bench.</span>
                  </div>

                  {(identifyResult.screenCondition || identifyResult.bodyCondition) && (
                    <div className="grid gap-2 sm:grid-cols-2 text-xs">
                      {identifyResult.screenCondition && (
                        <div className="rounded-xl border border-slate-200/80 bg-white/90 p-2.5 dark:border-white/10 dark:bg-slate-800/80">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">Screen Condition:</span>
                          <p className="mt-0.5 text-slate-600 dark:text-slate-400">{identifyResult.screenCondition}</p>
                        </div>
                      )}
                      {identifyResult.bodyCondition && (
                        <div className="rounded-xl border border-slate-200/80 bg-white/90 p-2.5 dark:border-white/10 dark:bg-slate-800/80">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">Body & Port Condition:</span>
                          <p className="mt-0.5 text-slate-600 dark:text-slate-400">{identifyResult.bodyCondition}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {identifyResult.visibleDamage.length > 0 && (
                    <div className="rounded-xl border border-slate-200/80 bg-white/90 p-2.5 text-xs dark:border-white/10 dark:bg-slate-800/80">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">Visible Physical Damage:</span>
                      <ul className="mt-1 list-inside list-disc text-slate-600 dark:text-slate-400 space-y-0.5">
                        {identifyResult.visibleDamage.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {identifyResult.notes && (
                    <p className="text-xs italic text-slate-500 dark:text-slate-400">
                      Note: {identifyResult.notes}
                    </p>
                  )}
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Category" required>
                  <Select
                    value={device.category}
                    onChange={(event) => setDevice((current) => ({ ...current, category: event.target.value }))}
                  >
                    {CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Brand" required>
                  <Input
                    value={device.brand}
                    onChange={(event) => setDevice((current) => ({ ...current, brand: event.target.value }))}
                    placeholder="e.g. Samsung"
                  />
                </Field>
                <Field label="Model" required>
                  <Input
                    value={device.model}
                    onChange={(event) => setDevice((current) => ({ ...current, model: event.target.value }))}
                    placeholder="e.g. Galaxy S23"
                  />
                </Field>
                <Field label="Colour">
                  <Input
                    value={device.color}
                    onChange={(event) => setDevice((current) => ({ ...current, color: event.target.value }))}
                    placeholder="Optional"
                  />
                </Field>
                <Field label="IMEI / serial" hint="Stored privately; never shown on the public report.">
                  <Input
                    value={device.imei}
                    onChange={(event) => setDevice((current) => ({ ...current, imei: event.target.value }))}
                    placeholder="Optional"
                  />
                </Field>
                <Field label="Accessories received">
                  <Input
                    value={device.accessories}
                    onChange={(event) => setDevice((current) => ({ ...current, accessories: event.target.value }))}
                    placeholder="e.g. Charger, case"
                  />
                </Field>
              </div>

              <Field label="Condition notes on intake" hint="Scratches, dents, missing screws — anything visible.">
                <Textarea
                  value={device.conditionNotes}
                  onChange={(event) =>
                    setDevice((current) => ({ ...current, conditionNotes: event.target.value }))
                  }
                  placeholder="Describe the physical condition of the device when it was received."
                />
              </Field>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">Reported problem</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Use the customer's own words where possible. This becomes the basis for diagnosis and
                  the quote.
                </p>
              </div>

              <ComplaintInput
                value={problem}
                onChange={setProblem}
                label="What did the customer report?"
                placeholder="e.g. Phone fell in water, screen flickers and the charging port does not work."
                required
              />

              <Field label="Priority" hint="Urgent repairs appear at the top of the shop's attention list.">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    ['LOW', 'Low', 'slate'],
                    ['NORMAL', 'Normal', 'indigo'],
                    ['HIGH', 'High', 'amber'],
                    ['URGENT', 'Urgent', 'red'],
                  ].map(([value, label, tone]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPriority(value)}
                      className={cn(
                        'rounded-xl border px-3 py-2.5 text-sm font-medium transition',
                        priority === value
                          ? tone === 'red'
                            ? 'border-rose-400 bg-rose-50 text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/15 dark:text-rose-300'
                            : tone === 'amber'
                              ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-amber-300'
                              : 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-500/15 dark:text-indigo-300'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-400 dark:hover:bg-white/[0.04]',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Field>

              {user?.role === 'OWNER' ? (
                <Field label="Assign technician">
                  <Select value={technicianId} onChange={(event) => setTechnicianId(event.target.value)}>
                    <option value="">Leave unassigned</option>
                    {technicians.data?.items
                      .filter((tech) => tech.active)
                      .map((tech) => (
                        <option key={tech.id} value={tech.id}>
                          {tech.name}
                          {tech.specialization ? ` · ${tech.specialization}` : ''}
                        </option>
                      ))}
                  </Select>
                </Field>
              ) : null}

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs leading-relaxed text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                <p className="font-semibold text-slate-700 dark:text-slate-200">What happens next?</p>
                <p className="mt-1">
                  The repair starts as <span className="font-medium">New Request</span>. You can then record
                  the device, run a diagnostic checklist, add parts, prepare a quote for owner approval,
                  and produce a QR service report at handover.
                </p>
              </div>
            </div>
          ) : null}

          {formError ? (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              {formError}
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 pt-4 dark:border-white/10">
            <Button
              variant="ghost"
              icon={ArrowLeft}
              onClick={() => setStep((current) => Math.max(0, current - 1))}
              disabled={step === 0}
            >
              Back
            </Button>
            {step < 2 ? (
              <Button icon={ArrowRight} onClick={goNext}>
                Continue
              </Button>
            ) : (
              <Button icon={Wrench} loading={create.isPending} onClick={submit}>
                Create repair
              </Button>
            )}
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Intake summary</h2>
            <div className="mt-4 space-y-4 text-sm">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Customer</p>
                {summaryCustomer ? (
                  <div className="mt-1">
                    <p className="font-medium text-slate-800 dark:text-slate-200">{summaryCustomer.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{summaryCustomer.phone}</p>
                    <Badge tone={summaryCustomer.returning ? 'emerald' : 'slate'} className="mt-1.5">
                      {summaryCustomer.returning ? 'Returning customer' : 'New customer'}
                    </Badge>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-slate-400">Not added yet</p>
                )}
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Device</p>
                {deviceReady ? (
                  <div className="mt-1">
                    <p className="font-medium text-slate-800 dark:text-slate-200">
                      {device.brand} {device.model}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{device.category}</p>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-slate-400">Brand and model needed</p>
                )}
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Problem</p>
                <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  {problem.trim() || 'Not described yet'}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Priority</p>
                <p className="mt-1 text-xs font-medium text-slate-700 dark:text-slate-300">{priority}</p>
              </div>
            </div>
          </Card>

          <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-500/25 dark:bg-indigo-500/[0.07]">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-indigo-800 dark:text-indigo-300">
              <Sparkles className="h-3.5 w-3.5" /> Honest AI
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-indigo-700/90 dark:text-indigo-300/80">
              FIXIT AI never invents parts prices or a diagnosis it cannot support. AI results are
              suggestions; you confirm every detail. When no AI provider is configured, manual entry and
              the offline checklist remain fully available.
            </p>
          </div>

          <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 p-3.5 text-xs leading-relaxed text-slate-500 dark:border-white/10 dark:text-slate-400">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            The customer's address and device identifiers are stored privately and are not published on
            the QR report.
          </div>
        </div>
      </div>

      <CameraCaptureModal
        open={cameraModalOpen}
        onClose={() => setCameraModalOpen(false)}
        onCapture={(file) => void uploadImage(file)}
      />
    </div>
  )
}
