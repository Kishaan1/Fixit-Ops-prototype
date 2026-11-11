import { useEffect, useRef, useState } from 'react'
import {
  Mic,
  MicOff,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react'
import { Badge, Textarea, cn } from './ui'

export const STANDARD_COMPLAINTS = [
  'Mobile not switching on',
  'Battery draining quickly',
  'Display broken',
  'Touch not working',
  'Charging not working',
  'Network problem',
  'Speaker not working',
  'Microphone not working',
  'Camera problem',
  'Water damage',
  'Laptop overheating',
  'Laptop not booting',
  'Keyboard not working',
  'Motherboard problem',
  'Software problem',
]

interface ComplaintInputProps {
  value: string
  onChange: (value: string) => void
  label?: string
  placeholder?: string
  hint?: string
  required?: boolean
  className?: string
}

export function ComplaintInput({
  value,
  onChange,
  label = 'Customer complaint / reported problem',
  placeholder = 'Describe the symptoms, circumstances of failure, or customer statements...',
  hint,
  required = true,
  className,
}: ComplaintInputProps) {
  const [listening, setListening] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (SpeechRecognition) {
      setSpeechSupported(true)
      const instance = new SpeechRecognition()
      instance.continuous = true
      instance.interimResults = true
      instance.lang = 'en-US'

      instance.onstart = () => {
        setListening(true)
        setStatusMessage('Listening… speak customer problem now')
      }

      instance.onresult = (event: any) => {
        let currentTranscript = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript
          if (event.results[i].isFinal) {
            onChange(value ? `${value.trim()} ${transcript.trim()}` : transcript.trim())
          } else {
            currentTranscript += transcript
          }
        }
        if (currentTranscript) {
          setStatusMessage(`Hearing: "${currentTranscript.slice(-40)}"`)
        }
      }

      instance.onerror = (event: any) => {
        console.warn('Speech recognition error', event.error)
        setListening(false)
        if (event.error === 'not-allowed') {
          setStatusMessage('Microphone access blocked. Please check browser permissions.')
        } else {
          setStatusMessage(`Voice input: ${event.error}`)
        }
        setTimeout(() => setStatusMessage(null), 4000)
      }

      instance.onend = () => {
        setListening(false)
        setStatusMessage(null)
      }

      recognitionRef.current = instance
    } else {
      setSpeechSupported(false)
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop()
        } catch {}
      }
    }
  }, [value, onChange])

  const toggleListening = () => {
    if (!speechSupported) {
      setStatusMessage('Voice recognition is not supported in this browser. Please use Chrome/Edge.')
      setTimeout(() => setStatusMessage(null), 4000)
      return
    }

    if (listening) {
      try {
        recognitionRef.current?.stop()
      } catch {}
      setListening(false)
      setStatusMessage(null)
    } else {
      try {
        recognitionRef.current?.start()
      } catch (e) {
        console.warn(e)
      }
    }
  }

  const addTag = (tag: string) => {
    if (!value) {
      onChange(tag)
    } else if (!value.toLowerCase().includes(tag.toLowerCase())) {
      onChange(`${value.trim()} · ${tag}`)
    }
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-sm font-semibold text-slate-800 dark:text-slate-200">
          {label} {required && <span className="text-rose-500">*</span>}
        </label>

        {/* Voice-to-Text Button */}
        <button
          type="button"
          onClick={toggleListening}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition shadow-xs',
            listening
              ? 'animate-pulse bg-rose-500 text-white shadow-rose-500/20'
              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08]',
          )}
          title={speechSupported ? 'Record customer problem via voice' : 'Speech recognition unavailable'}
        >
          {listening ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
              </span>
              <Mic className="h-3.5 w-3.5 text-white" />
              Recording… (click to stop)
            </>
          ) : (
            <>
              <Mic className="h-3.5 w-3.5 text-indigo-500" />
              Voice-to-Text
            </>
          )}
        </button>
      </div>

      {statusMessage && (
        <div className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300 flex items-center gap-1.5 animate-fadeIn">
          <Volume2 className="h-3.5 w-3.5 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Main text area */}
      <div className="relative">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="min-h-28 pr-10"
        />
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute top-2.5 right-2.5 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/10"
            title="Clear text"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Quick Problem Selectors from Specification */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Quick-select common complaints:
        </p>
        <div className="flex flex-wrap gap-1.5">
          {STANDARD_COMPLAINTS.map((complaint) => {
            const active = value.toLowerCase().includes(complaint.toLowerCase())
            return (
              <button
                key={complaint}
                type="button"
                onClick={() => addTag(complaint)}
                className={cn(
                  'rounded-lg border px-2.5 py-1 text-xs transition cursor-pointer',
                  active
                    ? 'border-indigo-400 bg-indigo-50 font-medium text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/15 dark:text-indigo-300'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-400 dark:hover:bg-white/[0.05]',
                )}
              >
                + {complaint}
              </button>
            )
          })}
        </div>
      </div>

      {hint && <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  )
}

