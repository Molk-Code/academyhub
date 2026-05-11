import { useState, useEffect, useRef } from 'react'
import { Smile } from 'lucide-react'

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  { label: 'Film & Production', emojis: ['🎬','🎥','📽','🎞','🎦','📹','🎭','🎨','🎙','🎤','🎧','🔊','💡','🔦','🎚','🎛','📡','🖥','📺','📸'] },
  { label: 'Education',         emojis: ['📚','📖','✏','📝','📋','📌','📍','🗂','📁','🗒','🧠','💡','🔬','🔭','⚗','🏫','🎓','📐','📏','🖊'] },
  { label: 'Creative',          emojis: ['🎨','🖌','✍','🖋','🖼','🎭','🎪','🎠','🪄','🌟','⭐','💫','🌈','🔮','🪩','🎯','🏆','🥇','🎗','🏅'] },
  { label: 'People & Roles',    emojis: ['🧑‍🎨','👩‍💻','🧑‍🏫','👨‍🎤','🎤','🧑‍🔧','👷','🕵','🦸','🤝','👥','🙋','🤔','💪','🫶','👁','🦶','🧩','🪞','🪢'] },
  { label: 'Objects',           emojis: ['🎒','🧳','📦','🗃','🔑','🪝','🪜','🧰','🔧','🔨','⚙','🪛','📡','💾','💿','🖨','📠','📟','🔋','🪫'] },
  { label: 'Symbols',           emojis: ['✅','❌','⚠','ℹ','🔴','🟡','🟢','🔵','🟣','⚫','⬆','⬇','➡','↩','🔄','💬','📢','🔔','🚫','🎵'] },
]

interface Props {
  value: string
  onChange: (emoji: string) => void
}

export default function EmojiPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-11 h-11 rounded-xl border border-white/15 bg-zinc-900 hover:border-brand-400 hover:bg-brand-50 transition-colors flex items-center justify-center text-xl shadow-sm"
        title="Pick emoji"
      >
        {value || <Smile className="w-5 h-5 text-zinc-400" />}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 bg-zinc-900 rounded-2xl border border-white/10 shadow-xl w-72 max-h-72 overflow-y-auto p-3 space-y-3">
          {EMOJI_GROUPS.map(group => (
            <div key={group.label}>
              <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">{group.label}</p>
              <div className="flex flex-wrap gap-0.5">
                {group.emojis.map(e => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => { onChange(e); setOpen(false) }}
                    className={`w-8 h-8 rounded-lg text-lg hover:bg-brand-50 flex items-center justify-center transition-colors ${value === e ? 'bg-brand-100 ring-1 ring-brand-400' : ''}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
