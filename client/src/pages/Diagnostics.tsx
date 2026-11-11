import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BookmarkCheck,
  Bot,
  Boxes,
  Camera,
  CheckCircle2,
  Clock,
  ExternalLink,
  Flame,
  Globe,
  HelpCircle,
  ImagePlus,
  Info,
  ListChecks,
  Loader2,
  PackageSearch,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Stethoscope,
  Trash2,
  Wrench,
} from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useToast } from '../lib/toast'
import type { AiStatus, DiagnosisResult, Repair } from '../lib/types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  StatCard,
  Tabs,
  Textarea,
  cn,
} from '../components/ui'
import { CameraCaptureModal } from '../components/CameraCaptureModal'
import { ComplaintInput } from '../components/ComplaintInput'
import { ImageDropzone, IMAGE_FORMATS_LABEL, MAX_IMAGE_MB } from '../components/ImageDropzone'

const CATEGORIES = ['Smartphone', 'Laptop', 'Tablet', 'Keypad Phone', 'Other']

export default function Diagnostics() {
  const { user } = useAuth()
  const { success, error } = useToast()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialRepairId = searchParams.get('repairId') || ''

  const [category, setCategory] = useState('Smartphone')
  const [brand, setBrand] = useState('')
  const [model, setModel] = useState('')
  const [problem, setProblem] = useState('')
  const [confirmedFault, setConfirmedFault] = useState('')
  const [technicianNotes, setTechnicianNotes] = useState('')
  const [selectedRepairId, setSelectedRepairId] = useState(initialRepairId)

  const [cameraOpen, setCameraOpen] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [identifiedImage, setIdentifiedImage] = useState<any>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const photoPreviewRef = useRef<string | null>(null)
  const [diagnosticsResult, setDiagnosticsResult] = useState<DiagnosisResult | null>(null)
  const [mode, setMode] = useState<'ai' | 'checklist'>('ai')

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

  const activeRepairs = useQuery({
    queryKey: ['repairs', 'active-select'],
    queryFn: () =>
      api.get<{ items: Repair[] }>('/repairs?pageSize=50&status=NEW_REQUEST,DEVICE_RECEIVED,AWAITING_INSPECTION,AI_DIAGNOSIS_COMPLETED'),
  })

  // Load selected repair details if chosen
  const handleSelectRepair = (repairId: string) => {
    setSelectedRepairId(repairId)
    if (!repairId) return
    const rep = activeRepairs.data?.items.find((r) => r.id === repairId)
    if (rep) {
      setCategory(rep.device.category)
      setBrand(rep.device.brand)
      setModel(rep.device.model)
      setProblem(rep.problem)
      if (rep.confirmedFault) setConfirmedFault(rep.confirmedFault)
    }
  }

  // Handle camera capture, drag-and-drop or file selection. The photo is always
  // stored with the intake record; AI identification is only attempted when a
  // provider is actually configured.
  const handleCapture = async (file: File) => {
    setUploadingImage(true)
    setLocalPhotoPreview(file)
    try {
      const uploadRes = await api.upload<{ filename: string; url: string }>('/uploads', file)
      setIdentifiedImage((prev: any) => ({ ...(prev || {}), url: uploadRes.url, imagePath: uploadRes.filename }))

      if (!aiStatus.data?.configured) {
        success(
          'Photo attached',
          'AI identification is not configured. The photo is saved for this diagnosis — enter the brand and model manually.',
        )
        return
      }

      try {
        const identification = await api.post<{ result: any; isAiPowered: boolean; disclaimer: string }>(
          '/ai/identify',
          { imagePath: uploadRes.filename },
        )
        setIdentifiedImage({ ...identification.result, url: uploadRes.url })
        if (identification.result.brand) setBrand(identification.result.brand)
        if (identification.result.model) setModel(identification.result.model)
        if (identification.result.category && CATEGORIES.includes(identification.result.category)) {
          setCategory(identification.result.category)
        }
        success(
          'Device identified',
          `Detected: ${identification.result.brand || 'Device'} ${identification.result.model || ''}. Please verify before proceeding.`,
        )
      } catch (err) {
        // Keep the uploaded photo even when identification is unavailable.
        error(
          'AI identification unavailable',
          `${errorMessage(err)} The photo is still attached — enter the details manually.`,
        )
      }
    } catch (err) {
      error('Upload failed', errorMessage(err))
      clearLocalPhotoPreview()
    } finally {
      setUploadingImage(false)
    }
  }

  const removePhoto = () => {
    clearLocalPhotoPreview()
    setIdentifiedImage(null)
  }

  // Diagnostic execution
  const runDiagnostic = useMutation({
    mutationFn: async (runMode: 'ai' | 'checklist') => {
      const res = await api.post<{
        diagnostic: DiagnosisResult
        savedDiagnostic: any
        disclaimer: string
      }>('/ai/diagnose', {
        category,
        brand,
        model,
        problem,
        confirmedFault: confirmedFault || undefined,
        technicianNotes: technicianNotes || undefined,
        mode: runMode,
        repairId: selectedRepairId || undefined,
      })
      return res
    },
    onSuccess: (data) => {
      setDiagnosticsResult(data.diagnostic)
      success(
        data.diagnostic.mode === 'AI' ? 'Global AI research complete' : 'Offline checklist generated',
        selectedRepairId ? 'Findings linked to repair ticket.' : 'Diagnostic recommendations ready for inspection.',
      )
    },
    onError: (err) => {
      error('Diagnostic request failed', errorMessage(err))
    },
  })

  const isAiConfigured = Boolean(aiStatus.data?.configured)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Global Repair Engine"
        title="AI Diagnostics & Research"
        description="Investigate known faults, iFixit service records, manufacturer troubleshooting advisories, and spare parts requirements for any mobile phone, laptop, or button device."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              icon={Camera}
              onClick={() => setCameraOpen(true)}
              loading={uploadingImage}
            >
              Capture Device
            </Button>
            <Link to="/parts">
              <Button variant="outline" icon={PackageSearch}>
                Spare Parts Discovery
              </Button>
            </Link>
          </div>
        }
      />

      {/* Global AI status banner */}
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 text-xs',
          isAiConfigured
            ? 'border-violet-200 bg-violet-50/70 text-violet-900 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200'
            : 'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200',
        )}
      >
        <div className="flex items-center gap-2.5">
          {isAiConfigured ? (
            <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-400 shrink-0" />
          ) : (
            <Info className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          )}
          <div>
            <span className="font-semibold">
              {isAiConfigured
                ? `Multimodal AI Enabled: ${aiStatus.data?.provider?.toUpperCase()} (${aiStatus.data?.model})`
                : 'Offline Bench Mode Active (Gemini API key not configured)'}
            </span>
            <p className="mt-0.5 text-slate-600 dark:text-slate-400">
              {isAiConfigured
                ? 'AI performs grounded research across public repair documentation. All AI predictions remain suggestions until confirmed by bench measurements.'
                : 'Complete offline ruleset engine is active. Step-by-step diagnostic checklists and parts guides work without internet or API keys.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge tone={isAiConfigured ? 'violet' : 'amber'}>
            {isAiConfigured ? 'Live Web Research' : 'Local Ruleset Engine'}
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Column: Device & Complaint Input (5 cols) */}
        <div className="space-y-6 lg:col-span-5">
          <Card>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-white/5">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Wrench className="h-4 w-4 text-indigo-500" /> Device & Intake Symptoms
              </h2>
              {selectedRepairId && (
                <button
                  type="button"
                  onClick={() => handleSelectRepair('')}
                  className="text-xs text-indigo-600 hover:underline dark:text-indigo-400 cursor-pointer"
                >
                  Clear ticket link
                </button>
              )}
            </div>

            <div className="mt-4 space-y-4">
              {/* Optional: Link to an Active Repair */}
              {activeRepairs.data?.items && activeRepairs.data.items.length > 0 && (
                <Field label="Link to active repair ticket (optional)">
                  <Select
                    value={selectedRepairId}
                    onChange={(e) => handleSelectRepair(e.target.value)}
                  >
                    <option value="">-- Ad-hoc bench research (not linked) --</option>
                    {activeRepairs.data.items.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.code} · {r.device.brand} {r.device.model} ({r.customer.name})
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              {/* Device Category, Brand, Model */}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <Field label="Device category" required>
                    <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <Field label="Brand" required>
                    <Input
                      value={brand}
                      onChange={(e) => setBrand(e.target.value)}
                      placeholder="e.g. Samsung, Apple, Dell, Nokia"
                    />
                  </Field>
                </div>
              </div>

              <Field label="Exact model number / name" required hint="Include variant (e.g. 5G, A546B, M1) for best results.">
                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. Galaxy A54 5G, iPhone 13 Pro, Inspiron 15 3511"
                />
              </Field>

              {/* Device photo dropzone */}
              <div className="space-y-2">
                <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Device photo (optional)
                </span>
                <ImageDropzone
                  onFile={handleCapture}
                  onError={(message) => error('Image not accepted', message)}
                  disabled={uploadingImage}
                  showError={false}
                  overlayLabel="Drop device photo here"
                  ariaLabel="Device photo upload. Drag and drop an image here, or click to browse."
                  className="overflow-hidden rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/60 dark:border-white/15 dark:bg-white/[0.03]"
                >
                  {photoPreview || identifiedImage?.url ? (
                    <div className="space-y-3 p-3">
                      <div className="relative h-40 w-full overflow-hidden rounded-xl ring-1 ring-slate-200 dark:ring-white/10">
                        <img
                          src={photoPreview || identifiedImage?.url}
                          alt="Device under diagnosis"
                          className="h-full w-full object-cover"
                        />
                        {uploadingImage ? (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-950/55 text-white">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            <span className="text-[10px] font-semibold">Uploading…</span>
                          </div>
                        ) : null}
                      </div>
                      <div
                        className="flex flex-wrap items-center gap-2"
                        data-dropzone-ignore
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          icon={Camera}
                          disabled={uploadingImage}
                          onClick={() => setCameraOpen(true)}
                        >
                          Retake / Replace
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          icon={Trash2}
                          disabled={uploadingImage}
                          onClick={removePhoto}
                        >
                          Remove
                        </Button>
                      </div>
                      <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                        Drag another photo straight into this box to replace it, or click the box to browse.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 px-4 py-6 text-center">
                      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-400">
                        {uploadingImage ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                          {uploadingImage ? 'Uploading device photo…' : 'Drag & Drop Device Photo Here'}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          Or{' '}
                          <span className="font-semibold text-indigo-600 underline dark:text-indigo-400">
                            Browse Files
                          </span>{' '}
                          — you can also use the camera.
                        </p>
                        <p className="mt-1 text-[11px] font-medium text-slate-400 dark:text-slate-500">
                          {IMAGE_FORMATS_LABEL} · Maximum {MAX_IMAGE_MB} MB
                        </p>
                      </div>
                    </div>
                  )}
                </ImageDropzone>
              </div>

              {/* Camera Photo Recognition Result if available */}
              {identifiedImage &&
              (identifiedImage.screenCondition ||
                identifiedImage.bodyCondition ||
                identifiedImage.notes) && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 text-xs dark:border-indigo-500/20 dark:bg-indigo-500/10">
                  <div className="flex items-center gap-2 font-semibold text-indigo-900 dark:text-indigo-200">
                    <CheckCircle2 className="h-4 w-4 text-indigo-600" />
                    <span>Visual Analysis Observations:</span>
                  </div>
                  <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-slate-700 dark:text-slate-300">
                    {identifiedImage.screenCondition && (
                      <li>Screen: {identifiedImage.screenCondition}</li>
                    )}
                    {identifiedImage.bodyCondition && (
                      <li>Body: {identifiedImage.bodyCondition}</li>
                    )}
                    {identifiedImage.notes && <li>{identifiedImage.notes}</li>}
                  </ul>
                </div>
              )}

              {/* Customer Problem Input with Voice-to-Text */}
              <ComplaintInput
                value={problem}
                onChange={setProblem}
                label="Customer reported problem"
                placeholder="e.g. Device does not turn on, no charging indicator, water contact, battery draining fast..."
                required
              />

              {/* Confirmed Fault & Technician Notes */}
              <div className="pt-2 border-t border-slate-100 dark:border-white/5 space-y-3">
                <Field
                  label="Technician confirmed fault (optional)"
                  hint="Fill only if you have already verified a specific hardware defect on the bench."
                >
                  <Input
                    value={confirmedFault}
                    onChange={(e) => setConfirmedFault(e.target.value)}
                    placeholder="e.g. Shorted CC1 line on USB-C port sub-board"
                  />
                </Field>

                <Field label="Technician bench notes (optional)">
                  <Textarea
                    value={technicianNotes}
                    onChange={(e) => setTechnicianNotes(e.target.value)}
                    placeholder="e.g. Ammeter draw: 0.00A at 5V. No liquid indicator triggered."
                    className="min-h-16"
                  />
                </Field>
              </div>

              {/* Action buttons to trigger AI or Offline Diagnosis */}
              <div className="pt-2 space-y-2">
                <Button
                  onClick={() => runDiagnostic.mutate('ai')}
                  disabled={!brand.trim() || !model.trim() || !problem.trim()}
                  loading={runDiagnostic.isPending}
                  className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold shadow-md shadow-violet-500/20 py-2.5"
                  icon={Sparkles}
                >
                  Run Global AI Research
                </Button>

                <Button
                  variant="outline"
                  onClick={() => runDiagnostic.mutate('checklist')}
                  disabled={!brand.trim() || !model.trim() || !problem.trim()}
                  loading={runDiagnostic.isPending}
                  className="w-full"
                  icon={ListChecks}
                >
                  Generate Offline Diagnostic Checklist
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {/* Right Column: Comprehensive 11-Point Output (7 cols) */}
        <div className="space-y-6 lg:col-span-7">
          {diagnosticsResult ? (
            <div className="space-y-6 animate-fadeIn">
              {/* Header Card with Model, Confidence, Difficulty */}
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xl font-bold text-slate-900 dark:text-white">
                        {brand} {model}
                      </span>
                      <Badge tone="indigo">{category}</Badge>
                      <Badge tone={diagnosticsResult.mode === 'AI' ? 'violet' : 'slate'}>
                        {diagnosticsResult.mode === 'AI' ? 'AI Grounded Research' : 'Local Checklist'}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Complaint: <span className="font-medium text-slate-700 dark:text-slate-300">"{problem}"</span>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {diagnosticsResult.confidence !== null && (
                      <div className="text-right">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          Confidence
                        </span>
                        <div className="flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400">
                          <span>{diagnosticsResult.confidence}%</span>
                        </div>
                      </div>
                    )}
                    {diagnosticsResult.difficulty && (
                      <div className="text-right">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          Difficulty
                        </span>
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          {diagnosticsResult.difficulty}
                        </div>
                      </div>
                    )}
                    {diagnosticsResult.estimatedMinutes && (
                      <div className="text-right">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                          Bench Time
                        </span>
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          ~{diagnosticsResult.estimatedMinutes} mins
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Summary Banner */}
                <div className="mt-4 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 text-sm leading-relaxed text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300">
                  <span className="font-semibold text-slate-900 dark:text-white">Diagnostic Summary: </span>
                  {diagnosticsResult.summary}
                </div>
              </Card>

              {/* 3. Model-Specific Known Issues */}
              {diagnosticsResult.commonFaults && diagnosticsResult.commonFaults.length > 0 && (
                <Card>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <Flame className="h-4 w-4 text-amber-500" />
                    Model-Specific Known Issues & Advisories
                  </h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Documented failure patterns and repair trends reported in global technician forums for this model.
                  </p>
                  <ul className="mt-3 divide-y divide-slate-100 text-xs text-slate-700 dark:divide-white/5 dark:text-slate-300">
                    {diagnosticsResult.commonFaults.map((fault, i) => (
                      <li key={i} className="py-2 flex items-start gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                        <span>{fault}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              {/* 4. Possible Causes */}
              <Card>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-indigo-500" />
                  Possible Root Causes (Ranked by Likelihood)
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Differentiated between model-specific known points of failure and general electronics possibilities.
                </p>
                <div className="mt-3 space-y-2">
                  {diagnosticsResult.causes.map((cause, i) => {
                    const isModelSpecific = cause.toLowerCase().includes('[model-specific]')
                    const cleanText = cause.replace(/\[model-specific\]/i, '').replace(/\[general\]/i, '').trim()
                    return (
                      <div
                        key={i}
                        className="flex items-start gap-2.5 rounded-xl border border-slate-200/80 p-3 text-xs dark:border-white/10"
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 font-bold text-slate-600 dark:bg-white/10 dark:text-slate-300 text-[10px]">
                          {i + 1}
                        </span>
                        <div className="flex-1">
                          <p className="font-medium text-slate-800 dark:text-slate-200">{cleanText}</p>
                        </div>
                        {isModelSpecific && (
                          <Badge tone="indigo">model-specific</Badge>
                        )}
                      </div>
                    )
                  })}
                </div>
              </Card>

              {/* 5. Recommended Diagnostic Tests */}
              <Card>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-emerald-500" />
                  Recommended Diagnostic Verification Steps
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Bench tests to isolate the defect in order of least invasive to board-level measurement.
                </p>
                <div className="mt-3 space-y-2">
                  {diagnosticsResult.tests.map((test, i) => (
                    <label
                      key={i}
                      className="flex items-start gap-2.5 rounded-xl border border-slate-200/70 p-3 text-xs hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/[0.02] cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-white/20"
                      />
                      <span className="text-slate-700 dark:text-slate-300 leading-relaxed">{test}</span>
                    </label>
                  ))}
                </div>
              </Card>

              {/* 6. Possible Solutions & Repair Procedures */}
              {diagnosticsResult.solutions && diagnosticsResult.solutions.length > 0 && (
                <Card>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-cyan-500" />
                    Recommended Repair Procedures
                  </h3>
                  <div className="mt-3 space-y-2">
                    {diagnosticsResult.solutions.map((sol, i) => (
                      <div
                        key={i}
                        className="rounded-xl border border-cyan-200/60 bg-cyan-50/30 p-3 text-xs text-slate-700 dark:border-cyan-500/20 dark:bg-cyan-500/5 dark:text-slate-300 flex items-start gap-2"
                      >
                        <span className="font-bold text-cyan-600 dark:text-cyan-400 shrink-0">Step {i + 1}:</span>
                        <span>{sol}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* 7. Required Spare Parts & Online Price Search Button */}
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                      <Boxes className="h-4 w-4 text-violet-500" />
                      Required / Recommended Spare Parts
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      Components needed to complete this repair. Check live online prices across distributors.
                    </p>
                  </div>
                  <Link to={`/parts?q=${encodeURIComponent(brand + ' ' + model)}`}>
                    <Button size="sm" icon={PackageSearch}>
                      Search Parts Online
                    </Button>
                  </Link>
                </div>

                <div className="mt-3 divide-y divide-slate-100 dark:divide-white/5">
                  {diagnosticsResult.parts.map((p, i) => {
                    const partName = typeof p === 'string' ? p : p.name
                    return (
                      <div
                        key={i}
                        className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs"
                      >
                        <span className="font-medium text-slate-800 dark:text-slate-200">{partName}</span>
                        <Link
                          to={`/parts?q=${encodeURIComponent(partName + ' ' + model)}`}
                          className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          Find supplier & price <ArrowRight className="h-3 w-3" />
                        </Link>
                      </div>
                    )
                  })}
                </div>
              </Card>

              {/* 11. Grounded Public Research Sources */}
              {diagnosticsResult.sources && diagnosticsResult.sources.length > 0 && (
                <Card>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <Globe className="h-4 w-4 text-blue-500" />
                    Public Research Sources & Citations
                  </h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Official service advisories, iFixit teardowns, and technical discussion threads used to compile this report.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {diagnosticsResult.sources.map((src, i) => (
                      <a
                        key={i}
                        href={src.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:text-indigo-400"
                      >
                        <span>{src.title || src.url}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    ))}
                  </div>
                </Card>
              )}

              {/* Disclaimer */}
              <div className="rounded-xl border border-slate-200/80 bg-slate-50 p-3.5 text-xs text-slate-500 dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-400 leading-relaxed">
                <span className="font-semibold text-slate-700 dark:text-slate-300">Verification Requirement: </span>
                AI analysis and global repair discussions are research suggestions, not proven defects. The technician is responsible for running multimeter and current draw tests before quoting or dismantling customer hardware.
              </div>
            </div>
          ) : (
            <Card padded={false} className="h-full flex items-center justify-center min-h-[460px]">
              <EmptyState
                icon={Bot}
                title="Ready to Diagnose"
                description="Enter the device brand, model, and customer complaint on the left, or capture a photo with your camera. Click 'Run Global AI Research' to query known failure points, testing steps, and spare parts."
              />
            </Card>
          )}
        </div>
      </div>

      {/* Camera Capture Modal */}
      <CameraCaptureModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={handleCapture}
      />
    </div>
  )
}

