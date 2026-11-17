import { useEffect, useMemo, useRef, useState } from 'react';
import { CLASSES, type OntologyGraph } from '@steamverse/shared';

interface Props {
  graph: OntologyGraph;
  onSelect: (id: string) => void;
}

export function SearchBox({ graph, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" 키로 검색창 포커스
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key === '/' && target?.tagName !== 'INPUT' && target?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return graph.nodes
      .filter((n) => n.label.toLowerCase().includes(q))
      .sort((a, b) => {
        const ap = a.label.toLowerCase().startsWith(q) ? 0 : 1;
        const bp = b.label.toLowerCase().startsWith(q) ? 0 : 1;
        return ap - bp || b.hours - a.hours;
      })
      .slice(0, 8);
  }, [graph, query]);

  const choose = (id: string) => {
    onSelect(id);
    setQuery('');
    setActive(0);
    inputRef.current?.blur();
  };

  return (
    <div className="relative">
      <svg className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-white/35" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="7" cy="7" r="5" />
        <path d="M11 11l3.5 3.5" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
          if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          if (e.key === 'Enter' && results[active]) choose(results[active].id);
          if (e.key === 'Escape') {
            setQuery('');
            inputRef.current?.blur();
          }
        }}
        placeholder="게임 · 회사 · 태그 · 친구"
        className="w-full rounded-xl border border-white/[0.07] bg-white/[0.03] py-2.5 pr-9 pl-9 text-[12.5px] text-white outline-none transition placeholder:text-white/30 focus:border-sky-300/30 focus:bg-white/[0.05]"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md border border-white/10 px-1.5 py-px font-mono text-[10px] text-white/35">
        /
      </kbd>
      {results.length > 0 && (
        <ul className="glass absolute top-full right-0 left-0 z-30 mt-2 overflow-hidden rounded-xl !bg-[#0b0e1a]/95 py-1.5">
          {results.map((n, i) => (
            <li key={n.id}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(n.id)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] transition ${i === active ? 'bg-white/[0.07] text-white' : 'text-white/70'}`}
              >
                <span className="size-[7px] shrink-0 rounded-full" style={{ background: CLASSES[n.cls].color }} />
                <span className="flex-1 truncate">{n.label}</span>
                <span className="font-mono text-[9.5px] tracking-wider text-white/30 uppercase">{CLASSES[n.cls].label.en}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
