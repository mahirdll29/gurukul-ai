export type SaaraMood = 'welcome' | 'idle' | 'thinking' | 'responding';

/** One layered portrait, with expressions driven by the assistant's request state. */
export function Saara({ mood = 'idle', className = '' }: { mood?: SaaraMood; className?: string }) {
  return <svg className={'saara saara-' + mood + ' ' + className} viewBox="0 0 220 220" aria-hidden="true" focusable="false">
    <circle cx="110" cy="110" r="105" fill="#e4eddf"/>
    <g fill="none" stroke="#bfcebb" strokeWidth=".9">
      <circle cx="110" cy="110" r="95"/><path d="M23 150Q91 169 192 62M30 74q65-29 155 86"/>
    </g>
    <g className="saara-figure">
      {/* Loosely tied hair and the fabric binding behind her shoulder. */}
      <path fill="#292537" d="M123 43q25-17 41 0 14 12 8 31 19 17 6 41 6 21-15 34l-29-11-19-69z"/>
      <path fill="none" stroke="#504052" strokeWidth="2" d="M148 43q31 7 14 36m3 9q13 14 0 34m-8-20q5 18-8 26"/>
      <path fill="#d8b35f" d="m147 68 17 6-3 7-17-7z"/>
      <path fill="#a96651" d="m87 129 40-3 1 32 19 8-25 29-46-26 13-13z"/>
      <path fill="#7e493c" d="m89 132 37-8-1 17q-17 12-37 4z" />
      {/* Dark indigo knit, ivory open collar, and stitched shoulder seams. */}
      <path fill="#304966" d="m85 151-28 10q-19 7-27 33c27 22 52 24 79 24 32 0 63-6 84-22-7-26-16-33-37-40l-26-8-19 22z"/>
      <path fill="#20364f" d="m98 174 14 24 26-43-8-6-19 18-24-16z"/>
      <path fill="#fff4d9" d="m85 148 25 17-9 18-29-27zm43-3-18 20 7 14 22-26z"/>
      <path fill="none" stroke="#698296" strokeWidth="1.3" d="m52 176 8 33m102-41-6 44M76 157l24 32 9-17m11 13 22-30"/>
      <path fill="none" stroke="#536d86" d="m38 194 11 6m-8-10 10 5m114 6 13-6m-12 2 11-6"/>
      <g className="saara-head">
        <path fill="#302838" d="M63 89q-9-40 20-55 34-20 60 1 24 17 12 58l-13 32-70-3z"/>
        <path fill="#c88568" d="M71 86q-13-8-15 4-1 14 16 24m66-22q15-11 17 2-2 17-18 21"/>
        <path fill="none" stroke="#9b5a4b" strokeWidth="2" d="m62 94 5 6m79-3-5 6"/>
        <path fill="#d99b79" d="M69 79q3-32 35-34 31 0 40 29l-3 27c-1 17-11 31-25 39-5 3-12 5-18 2-17-6-28-18-30-37z"/>
        <path fill="#e7ad89" d="M73 85q0-22 23-29 7 7 4 18-10 14-6 29-13 12-23 1z" opacity=".5"/>
        <path fill="#312738" d="M64 96q-10-31 8-50 18-21 43-16 28 3 34 24 7 20-5 38l-6-11c-3-11-3-18-9-24-15 14-30 14-41 11 12-2 19-7 25-15-12 10-29 11-37 27l-3 19z"/>
        <g fill="none" stroke="#64505a" strokeWidth="1.5" strokeLinecap="round">
          <path d="M65 70q12-27 46-31m-32 16q13-12 34-14m11-4q15 3 20 18m-7 9q3 7 3 13"/>
        </g>
        <g className="saara-brows" fill="none" stroke="#4c3031" strokeWidth="3.3" strokeLinecap="round"><path d="M78 85q8-5 15-2m20 0q8-4 17 1"/></g>
        <g className="saara-eyes">
          <path d="M78 94q7-7 16 0-8 5-16 0m35-1q8-7 16 0-8 5-16 0" fill="#fff5e8"/>
          <g fill="#332c35"><ellipse cx="87" cy="93" rx="3" ry="3.8"/><ellipse cx="121" cy="92" rx="3" ry="3.8"/></g>
          <path d="M78 94q7-7 16 0m19-1q8-7 16 0" fill="none" stroke="#48313a" strokeWidth="1.6" strokeLinecap="round"/>
          <g fill="#fff"><circle cx="88" cy="92" r=".9"/><circle cx="122" cy="91" r=".9"/></g>
        </g>
        <g fill="none" stroke="#584437" strokeWidth="2.5">
          <path d="M70 87q12-5 28-1l-1 11q-2 9-14 7-10-1-12-12zm39-2q15-4 26 0l-1 9q-1 10-13 10-11 0-12-10zM98 90q5-4 11-1m26-2 8-4m-72 6-6-2"/>
        </g>
        <path fill="none" stroke="#a9624e" strokeWidth="1.65" strokeLinecap="round" d="m105 93-4 14q2 3 7 2"/>
        <g fill="#bd745c" opacity=".6"><ellipse cx="81" cy="109" rx="6" ry="2.7"/><ellipse cx="128" cy="107" rx="6" ry="2.7"/></g>
        <path className="saara-smile" d="M91 118q11 4 23-2-9 14-23 2" fill="#90544e"/>
        <path className="saara-lips" d="M93 118q10 3 18-1-7 6-18 1" fill="#fff1da"/>
        <path fill="none" stroke="#9e6352" strokeLinecap="round" d="M99 128q4 1 8-1"/>
        <g fill="none" stroke="#ba8a39" strokeWidth="2.6"><ellipse cx="66" cy="110" rx="3.1" ry="6"/><ellipse cx="143" cy="109" rx="3" ry="5.7"/></g>
      </g>
    </g>
  </svg>;
}

