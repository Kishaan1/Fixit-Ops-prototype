import { AI_ENABLED } from '../env'
import { dedupeSources, extractJsonObject, geminiGenerate, type AiSource } from './ai'
import { HttpError } from './http'

export type DiagnosticPayload = {
  mode: 'AI' | 'LOCAL_RULESET' | 'MANUAL'
  provider: string | null
  model: string | null
  summary: string
  commonFaults?: string[]
  causes: string[]
  tests: string[]
  solutions?: string[]
  parts: string[]
  difficulty: string
  estimatedMinutes: number | null
  confidence: number | null
  sources: AiSource[]
  rawText: string | null
}

function stringArray(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .slice(0, limit)
}

function clampConfidence(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const percent = n <= 1 ? n * 100 : n
  return Math.max(0, Math.min(100, Math.round(percent)))
}

export async function identifyDevice(input: {
  imageBase64: string
  mimeType: string
  originalFilename?: string
  hint?: string
}): Promise<Record<string, unknown>> {
  // No provider means no identification. Return an explicit configured error
  // rather than guessing a model or inventing visible damage.
  if (!AI_ENABLED) {
    throw new HttpError(
      503,
      'Photo identification needs a configured AI provider. Enter the brand, model and visible condition manually — no result has been guessed.',
      { code: 'AI_NOT_CONFIGURED' },
    )
  }

  // If Gemini AI is configured, run multimodal visual analysis
  if (AI_ENABLED) {
    try {
      const prompt = `You are assisting an expert repair technician identify an electronic device from a photograph.
Return ONLY a valid JSON object with these keys:
{
  "category": "Smartphone | Laptop | Tablet | Keypad Phone | Other",
  "brand": "detected manufacturer (e.g. Samsung, Apple, Xiaomi, Dell, HP, Nokia)",
  "model": "detected exact model or closest model series (e.g. Galaxy A54 5G, iPhone 14 Pro)",
  "generation": "approximate generation or release year",
  "color": "detected enclosure color (e.g. Graphite, Silver, Space Black)",
  "confidence": 0-100,
  "visibleDamage": ["list of visible physical damages like cracks, dents, scuffs, missing glass"],
  "screenCondition": "condition of display glass and screen panel",
  "bodyCondition": "condition of chassis, frame, charging port, and rear panel",
  "missingComponents": ["any missing screws, buttons, SIM tray, or covers"],
  "notes": "one concise paragraph describing the visual identification and what the technician should confirm on the bench",
  "clarifyingQuestions": ["identifying details to check such as model code under settings or on rear housing"]
}

Rules:
- Only describe what is physically visible. Do NOT claim an internal logic board fault from a photo.
- The technician verifies the result on the bench.
- Return ONLY the JSON object without markdown or conversational text.`

      const result = await geminiGenerate({
        prompt,
        imageBase64: input.imageBase64,
        mimeType: input.mimeType,
        useSearch: false,
      })
      const parsed = extractJsonObject(result.text)
      if (parsed && typeof parsed.brand === 'string' && parsed.brand.trim()) {
        return {
          category: typeof parsed.category === 'string' ? parsed.category : 'Other',
          brand: parsed.brand.trim(),
          model: typeof parsed.model === 'string' ? parsed.model.trim() : '',
          generation: typeof parsed.generation === 'string' ? parsed.generation.trim() : '',
          color: typeof parsed.color === 'string' ? parsed.color.trim() : '',
          confidence: clampConfidence(parsed.confidence),
          visibleDamage: stringArray(parsed.visibleDamage),
          screenCondition: typeof parsed.screenCondition === 'string' ? parsed.screenCondition : '',
          bodyCondition: typeof parsed.bodyCondition === 'string' ? parsed.bodyCondition : '',
          missingComponents: stringArray(parsed.missingComponents),
          notes: typeof parsed.notes === 'string' ? parsed.notes : 'Visual identification returned by the AI provider. Verify the model before ordering parts.',
          clarifyingQuestions: stringArray(parsed.clarifyingQuestions),
        }
      }
    } catch (err) {
      console.warn('[ai] Gemini vision identification failed or timed out; no result will be guessed:', err)
    }
  }

  throw new HttpError(
    502,
    'Photo identification is temporarily unavailable. Enter the brand and model manually and record the visible condition yourself.',
    { code: 'AI_UNAVAILABLE' },
  )
}

export async function aiDiagnose(input: {
  brand: string
  model: string
  category: string
  problem: string
  confirmedFault?: string | null
  technicianNotes?: string | null
}): Promise<DiagnosticPayload> {
  if (!AI_ENABLED) {
    throw new HttpError(
      503,
      'AI research is not configured. Use the offline checklist or enter findings manually.',
      { code: 'AI_NOT_CONFIGURED' },
    )
  }

  const prompt = `You are a repair research assistant for a professional device repair shop.
Device: ${input.brand} ${input.model} (${input.category})
Customer-reported problem: "${input.problem}"
${input.confirmedFault ? `Technician-confirmed fault (treat as established): "${input.confirmedFault}"` : 'No technician-confirmed fault yet.'}
${input.technicianNotes ? `Technician observations: "${input.technicianNotes}"` : ''}

Research known, model-specific repair information from reputable public sources (manufacturer support/service documentation, iFixit, established repair communities). Use web research when available. Distinguish clearly between model-specific evidence and general repair knowledge.

Return ONLY a JSON object:
{
  "summary": "2-3 sentences. Say explicitly which parts are model-specific research and which are general possibilities.",
  "commonFaults": ["documented common faults or service advisories known for this specific model/brand"],
  "causes": ["ranked possible causes, each prefixed with [model-specific] or [general]"],
  "tests": ["concrete diagnostic tests the technician should run, in order"],
  "solutions": ["recommended repair procedure or action steps to fix the issue"],
  "parts": ["likely spare parts, names only, no invented prices"],
  "difficulty": "Easy | Moderate | Hard",
  "estimatedMinutes": 45,
  "confidence": 0-100,
  "sources": [{"title": "source title", "url": "https://..."}]
}

Rules:
- Never present a possibility as a confirmed defect.
- If you cannot find model-specific information, say so in the summary and lower confidence.
- Never invent prices, suppliers, part numbers, statistics or source URLs. Only list URLs you actually used.
- Keep causes, tests and solutions practical for a repair bench. No markdown, no text outside the JSON.`

  const result = await geminiGenerate({ prompt, useSearch: true })
  const parsed = extractJsonObject(result.text)
  const sources = dedupeSources([
    ...result.sources,
    ...(Array.isArray(parsed?.sources)
      ? (parsed!.sources as Array<Record<string, unknown>>)
        .map((s) => ({
          title: typeof s?.title === 'string' ? s.title : '',
          url: typeof s?.url === 'string' ? s.url : '',
        }))
        .filter((s) => /^https?:\/\//.test(s.url))
      : []),
  ])

  if (!parsed) {
    return {
      mode: 'AI',
      provider: result.provider,
      model: result.model,
      summary: result.text.slice(0, 2000),
      commonFaults: [],
      causes: [],
      tests: [],
      solutions: [],
      parts: [],
      difficulty: 'Unknown',
      estimatedMinutes: null,
      confidence: null,
      sources,
      rawText: result.text,
    }
  }

  return {
    mode: 'AI',
    provider: result.provider,
    model: result.model,
    summary: typeof parsed.summary === 'string' ? parsed.summary : 'AI research completed.',
    commonFaults: stringArray(parsed.commonFaults),
    causes: stringArray(parsed.causes),
    tests: stringArray(parsed.tests),
    solutions: stringArray(parsed.solutions),
    parts: stringArray(parsed.parts),
    difficulty: typeof parsed.difficulty === 'string' ? parsed.difficulty : 'Unknown',
    estimatedMinutes: Number.isFinite(Number(parsed.estimatedMinutes))
      ? Math.max(0, Math.round(Number(parsed.estimatedMinutes)))
      : null,
    confidence: clampConfidence(parsed.confidence),
    sources,
    rawText: result.text,
  }
}

type Checklist = {
  match: RegExp
  title: string
  commonFaults: string[]
  causes: string[]
  tests: string[]
  solutions: string[]
  parts: string[]
  difficulty: string
  estimatedMinutes: number
}

const CHECKLISTS: Checklist[] = [
  {
    match: /charg|not charging|plug/i,
    title: 'Charging fault',
    commonFaults: [
      'Type-C / Lightning port debris or lint accumulation',
      'Port flex fatigue after 12-18 months of daily use',
      'PMIC charging controller solder joint degradation',
      'Sub-board connector loose following impact',
    ],
    causes: [
      'Charger, cable or wall outlet (verify with a known-good charger first)',
      'Charging port contamination, bent pins or loose connector',
      'Battery health or battery connector issue',
      'Charging flex / port board fault',
      'Charging IC or board-level power path (requires measurement)',
      'Software or USB negotiation fault (test in safe mode / known-good OS)',
    ],
    tests: [
      'Try a known-good charger and cable; measure charging current using USB ammeter.',
      'Inspect and clean the charging port under magnification; check for play or bent pins.',
      'Check battery health and connector seating.',
      'Test with the port flex/board if the model has a separate one.',
      'Check for corrosion or liquid damage before board-level work.',
    ],
    solutions: [
      'Clean charging port with ESD-safe probe and 99% isopropyl alcohol.',
      'Replace charging sub-board / flex assembly if pins are corroded or worn.',
      'Reseat main-to-sub interconnect cable.',
      'Replace battery if internal resistance is elevated or cycle count is depleted.',
    ],
    parts: ['Charging port flex/board', 'Battery (if health fails)', 'Interconnect flex cable', 'Charging IC (board-level, if proven)'],
    difficulty: 'Moderate',
    estimatedMinutes: 60,
  },
  {
    match: /display|screen|broken|lcd|oled|touch/i,
    title: 'Display / touch fault',
    commonFaults: [
      'Digitizer trace fracture from drop impact',
      'OLED purple bleed or black ink spots expanding from stress cracks',
      'Touch IC solder joint fracture under mechanical flex',
      'Display FPC latch dislodged from shock',
    ],
    causes: [
      'Cracked or damaged display assembly',
      'Display flex/connector damage or loose seating',
      'Touch digitizer fault (separate from display on some models)',
      'Board-level display backlight or driver fault (less common)',
    ],
    tests: [
      'Inspect glass, OLED/LCD and touch response separately with diagnostic touch grid.',
      'Check display flex and connector for physical damage or corrosion.',
      'Test with a known-good display assembly before board-level diagnosis.',
      'Verify touch in all quadrants and test after a soft reset.',
    ],
    solutions: [
      'Disassemble device following manufacturer thermal release profile.',
      'Transfer ear speaker, proximity sensor and bracket to new assembly.',
      'Apply fresh pre-cut perimeter adhesive gasket.',
      'Perform full multi-touch touch screen calibration and ambient light test.',
    ],
    parts: ['Display assembly', 'Display flex (if separate)', 'Adhesive / seal', 'B-7000 frame sealant'],
    difficulty: 'Moderate',
    estimatedMinutes: 75,
  },
  {
    match: /battery|drain|backup|charge hold/i,
    title: 'Battery / power endurance fault',
    commonFaults: [
      'Chemical aging after 500+ cycles resulting in capacity degradation',
      'Gas buildup leading to battery swelling / back cover lifting',
      'High standby drain caused by leaky SMD capacitor on VDD_MAIN rail',
    ],
    causes: [
      'Battery wear or swelling',
      'Background app or software drain',
      'Charging system not fully charging the battery',
      'Board-level power leakage (requires measurement)',
    ],
    tests: [
      'Read battery health/cycle count if available.',
      'Observe standby drain with radios off and in safe mode.',
      'Measure charge/discharge current.',
      'Inspect battery for swelling or damage.',
    ],
    solutions: [
      'Replace battery assembly with fresh OEM/compatible cell.',
      'Verify no parasitic drain on DC power supply before sealing.',
      'Perform battery calibration cycle (drain to 5%, full uninterrupted charge to 100%).',
    ],
    parts: ['Battery', 'Pre-cut battery adhesive pull tabs', 'Charging port flex (if charging is also affected)'],
    difficulty: 'Easy',
    estimatedMinutes: 45,
  },
  {
    match: /not switching|no power|dead|boot|start/i,
    title: 'No power / boot fault',
    commonFaults: [
      'Battery completely drained past safety threshold cutoff',
      'Short to ground on primary power rail (PP_VDD_MAIN / VPH_PWR)',
      'Power button flex switch mechanically collapsed',
      'Corrupted NAND / bootloader following interrupted OTA update',
    ],
    causes: [
      'Discharged or failed battery',
      'Charger or charging port fault',
      'Power button / flex fault',
      'Corrupted firmware or failed update',
      'Board-level power rail fault (requires measurement)',
    ],
    tests: [
      'Charge with a known-good adapter and measure current draw.',
      'Try a forced restart / recovery mode combination for the model.',
      'Inspect for liquid damage or corrosion.',
      'Check power button response and flex seating.',
      'Measure key power rails only if board-level repair is in scope.',
    ],
    solutions: [
      'Boost battery on bench power supply if voltage dropped below cutoff.',
      'Flash firmware via authorized recovery tool after backing up user credentials.',
      'Inject low voltage on primary rail using thermal imaging to locate shorted capacitor.',
    ],
    parts: ['Battery', 'Charging port flex', 'Power button flex (if separate)', 'Power IC / PMIC'],
    difficulty: 'Hard',
    estimatedMinutes: 90,
  },
  {
    match: /network|sim|signal|imei|wifi|wi-fi|bluetooth/i,
    title: 'Connectivity fault',
    commonFaults: [
      'Antenna coaxial cable popped off during previous drop or repair',
      'SIM card detection pin bent inside socket',
      'Baseband power IC (BB PMIC) cold solder joints',
      'Wi-Fi / BT module solder detachment',
    ],
    causes: [
      'SIM tray/contact or SIM provisioning issue',
      'Antenna/coaxial cable or antenna flex fault',
      'Network settings or carrier configuration',
      'Modem/board-level fault (requires targeted testing)',
    ],
    tests: [
      'Test a known-good SIM and confirm carrier service status.',
      'Check network settings, APN and airplane mode.',
      'Inspect antenna cables and connectors if the device was opened.',
      'Compare Wi-Fi/Bluetooth behaviour to isolate the radio path.',
    ],
    solutions: [
      'Re-seat antenna RF coaxial pigtails into board sockets.',
      'Straighten bent SIM tray pins or replace SIM connector assembly.',
      'Re-ball or re-flow baseband PMIC if baseband firmware version is missing in settings.',
    ],
    parts: ['SIM tray', 'Antenna flex/cable (model-dependent)', 'RF Coaxial Cable', 'Modem/board-level repair (if proven)'],
    difficulty: 'Hard',
    estimatedMinutes: 90,
  },
  {
    match: /speaker|sound|audio|mic|microphone|earpiece/i,
    title: 'Audio fault',
    commonFaults: [
      'Debris, lint, or makeup blocking earpiece acoustic mesh',
      'Speaker coil blown due to moisture ingress',
      'Microphone acoustic hole blocked by dirt or phone protective case',
    ],
    causes: [
      'Blocked speaker/microphone mesh or debris',
      'Speaker/earpiece/microphone flex fault',
      'Audio connector or board-level fault',
      'Software audio routing issue',
    ],
    tests: [
      'Test speaker, earpiece and microphone separately with a known recording.',
      'Clean the mesh and inspect for liquid damage.',
      'Check the relevant flex/connector seating.',
      'Test after a safe-mode boot to exclude software routing.',
    ],
    solutions: [
      'Ultrasonic cleaning of acoustic mesh membranes.',
      'Replace loudspeaker buzzer module or top earpiece speaker.',
      'Replace primary microphone sub-board flex.',
    ],
    parts: ['Speaker / earpiece', 'Microphone flex', 'Acoustic dust mesh', 'Audio flex (model-dependent)'],
    difficulty: 'Moderate',
    estimatedMinutes: 60,
  },
  {
    match: /camera|lens|flash/i,
    title: 'Camera fault',
    commonFaults: [
      'Optical Image Stabilization (OIS) gyroscope damaged from motorcycle vibrations',
      'Camera lens outer sapphire glass cracked allowing dust into sensor',
      'Camera connector detached from main logic board',
    ],
    causes: [
      'Camera lens/module damage',
      'Camera connector loose or damaged',
      'Camera flex fault',
      'Software permission or camera service issue',
      'Board-level camera interface fault (less common)',
    ],
    tests: [
      'Test front and rear cameras separately, including flash.',
      'Inspect lens glass and module seating.',
      'Reseat the camera connector; check for corrosion.',
      'Test in a different camera app to exclude software.',
    ],
    solutions: [
      'Replace damaged camera outer glass bezel and clean sensor optic.',
      'Replace main camera module assembly.',
      'Re-seat camera connector and verify 2.8V / 1.8V camera supply rails.',
    ],
    parts: ['Rear camera module', 'Front camera module', 'Camera lens glass', 'Camera flex (if separate)'],
    difficulty: 'Moderate',
    estimatedMinutes: 60,
  },
  {
    match: /water|liquid|corrosion|wet/i,
    title: 'Liquid damage',
    commonFaults: [
      'Electrochemical corrosion on battery connector and display connector',
      'Corroded filter inductors and decoupling caps causing power leakage',
      'Backlight circuit diode burned out under moisture',
    ],
    causes: [
      'Residual liquid/corrosion on the board or connectors',
      'Shorted or damaged components',
      'Battery/charging circuit damage',
      'Display or flex damage from moisture',
    ],
    tests: [
      'Do not power on; disassemble and inspect for corrosion under microscope.',
      'Clean the board in an ultrasonic bath with appropriate solution if in scope.',
      'Check for short circuits on key rails before applying power.',
      'Test battery and charging circuit separately after cleaning.',
    ],
    solutions: [
      'Perform ultrasonic PCB wash with anhydrous isopropyl alcohol.',
      'Inspect and scrape away galvanic corrosion; resolder oxidized pads.',
      'Replace shorted ceramic capacitors on primary rails.',
      'Replace battery and display if moisture penetrated internal layers.',
    ],
    parts: ['Battery (if damaged)', 'Affected flex/connector', 'Board-level components (if proven)', 'B-7000 seal'],
    difficulty: 'Hard',
    estimatedMinutes: 120,
  },
  {
    match: /overheat|hot|thermal|fan/i,
    title: 'Overheating / thermal fault',
    commonFaults: [
      'Thermal paste desiccated into dry powder after 2+ years',
      'Exhaust heatsink fins blocked by dense felt of dust fibers',
      'Cooling fan bearing seized or running at diminished RPM',
    ],
    causes: [
      'Dust-blocked vents or fan failure (laptops)',
      'Dried thermal paste or poor heatsink contact',
      'Background process or malware load',
      'Battery swelling or charging fault',
      'Board-level power fault (requires measurement)',
    ],
    tests: [
      'Monitor temperatures at idle and under load using thermal sensors.',
      'Clean vents/fan and confirm fan operation.',
      'Repaste the CPU/GPU heatsink if temperatures remain high.',
      'Check for runaway processes and battery swelling.',
    ],
    solutions: [
      'Completely clean fan blades and radiator heatsink fins using compressed air.',
      'Clean old thermal compound with Arctic Clean and re-apply Arctic MX-4 paste.',
      'Replace seized cooling fan assembly.',
    ],
    parts: ['High-performance thermal paste (MX-4)', 'Thermal pads', 'Cooling fan (if failed)', 'Battery (if swollen)'],
    difficulty: 'Moderate',
    estimatedMinutes: 75,
  },
  {
    match: /keyboard|key|trackpad|touchpad/i,
    title: 'Keyboard / input fault',
    commonFaults: [
      'Beverage spill causing sticky scissor switches or oxidized traces',
      'Keyboard flex cable ribbon torn at hinge',
      'Swollen battery applying upward pressure on trackpad / keyboard membrane',
    ],
    causes: [
      'Liquid damage or debris under keys',
      'Keyboard flex/connector fault',
      'Top case / keyboard replacement required',
      'Software filter or driver issue',
    ],
    tests: [
      'Test every key with a keyboard tester; note patterns.',
      'Check keyboard flex connector and corrosion.',
      'Test an external keyboard to isolate the built-in one.',
      'Check accessibility/filter settings and drivers.',
    ],
    solutions: [
      'Clean scissor switches with contact cleaner if minor debris.',
      'Replace keyboard assembly or top case.',
      'Inspect battery for swelling and replace if pinching trackpad.',
    ],
    parts: ['Keyboard', 'Keyboard flex (if separate)', 'Top case / palmrest', 'Trackpad assembly'],
    difficulty: 'Moderate',
    estimatedMinutes: 75,
  },
  {
    match: /motherboard|board|short|component/i,
    title: 'Board-level fault',
    commonFaults: [
      'Cracked MLCC ceramic capacitor shorting main power rail to ground',
      'Power management IC (PMIC) failure from voltage surge or car charger',
      'Torn solder pads under BGA chips following severe drop impact',
    ],
    causes: [
      'Shorted or open component on a power rail',
      'Liquid damage/corrosion',
      'Damaged connector or pad',
      'Failed PMIC/charging IC (requires measurement)',
    ],
    tests: [
      'Visual inspection under magnification for corrosion/damage.',
      'Measure key rails for shorts before applying power.',
      'Use a thermal camera/current draw to localise the fault.',
      'Confirm with schematic/boardview where legally available.',
    ],
    solutions: [
      'Locate shorted capacitor via freeze spray or thermal imaging and replace.',
      'Re-ball or replace damaged PMIC using hot air rework station.',
      'Micro-solder jumper wire for severed copper traces.',
    ],
    parts: ['Board-level components (only after fault is proven)', 'SMD capacitors', 'PMIC', 'Connectors as required'],
    difficulty: 'Hard',
    estimatedMinutes: 150,
  },
  {
    match: /software|update|firmware|virus|slow|hangs|os/i,
    title: 'Software / firmware fault',
    commonFaults: [
      'Corrupted partition table or failed over-the-air (OTA) update',
      'Storage SSD / UFS 99% full causing system bootloop',
      'Driver conflict or background miner process',
    ],
    causes: [
      'Corrupted OS or failed update',
      'Incompatible app/driver or malware',
      'Storage full or failing storage',
      'Account/activation or provisioning issue',
    ],
    tests: [
      'Back up data where possible before changes.',
      'Boot safe mode / recovery and check logs.',
      'Test storage health and free space.',
      'Reinstall or repair the OS only after confirming data backup.',
    ],
    solutions: [
      'Clear system cache partition in recovery mode.',
      'Perform clean flash of official factory firmware with data preservation if possible.',
      'Upgrade internal storage or replace SSD if SMART health test fails.',
    ],
    parts: ['Storage drive / SSD (only if health test fails)', 'No part expected for software-only faults'],
    difficulty: 'Easy',
    estimatedMinutes: 60,
  },
]

export function localChecklist(input: {
  category: string
  problem: string
}): DiagnosticPayload {
  const checklist = CHECKLISTS.find((c) => c.match.test(input.problem))
  const isLaptop = /laptop|desktop/i.test(input.category)
  const base = checklist ?? {
    title: 'General fault',
    commonFaults: [
      'Physical wear and tear on external connectors',
      'Consumable aging (battery, thermal compound, switches)',
      'Loose internal ribbons following impact or thermal cycles',
    ],
    causes: [
      'Customer-reported symptom needs reproduction and direct inspection',
      'Connector, flex or consumable wear',
      'Software/configuration issue',
      'Board-level fault (only after targeted measurements)',
    ],
    tests: [
      'Reproduce the fault and record exact conditions.',
      'Inspect for physical/liquid damage and loose connectors.',
      'Test with known-good accessories or a known-good part where safe.',
      'Document measurements before board-level work.',
    ],
    solutions: [
      'Disassemble and conduct comprehensive bench diagnostic.',
      'Clean all contacts with ESD-safe isopropyl alcohol.',
      'Reseat flex connections and test in open frame mode.',
    ],
    parts: ['To be determined after inspection'],
    difficulty: 'Moderate',
    estimatedMinutes: 60,
  }

  return {
    mode: 'LOCAL_RULESET',
    provider: null,
    model: null,
    summary: `Offline ${base.title.toLowerCase()} checklist${isLaptop ? ' for a laptop/desktop' : ''}. This is bench guidance generated without internet research — it is not model-specific and not a confirmed diagnosis. Verify each step on the bench.`,
    commonFaults: base.commonFaults,
    causes: base.causes,
    tests: base.tests,
    solutions: base.solutions,
    parts: base.parts,
    difficulty: base.difficulty,
    estimatedMinutes: base.estimatedMinutes,
    confidence: null,
    sources: [],
    rawText: null,
  }
}
