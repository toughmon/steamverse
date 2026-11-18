import { LEGAL_NOTICE, type OntologyGraph } from '@steamverse/shared';
import { AchievementCalendar } from './achievements/AchievementCalendar';
import { RareShowcase } from './achievements/RareShowcase';

interface Props {
  graph: OntologyGraph;
  onOpenInExplorer: (id: string) => void;
}

/** 업적: 언제 무엇에 빠져 있었는지(캘린더)와, 자랑할 만한 업적(희귀 업적) */
export function AchievementsView({ graph, onOpenInExplorer }: Props) {
  const total = graph.nodes.reduce((a, n) => a + (n.game?.achievementLog?.length ?? 0), 0);
  const games = graph.nodes.filter((n) => n.game?.achievementLog?.length).length;
  return (
    <div className="sv-scroll h-full overflow-y-auto bg-[#04050a]">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-8 pt-10 pb-16">
        <header className="mb-4">
          <div className="eyebrow">Achievements</div>
          <h1 className="mt-2 text-[30px] font-semibold tracking-tight text-white">업적으로 되살린 내 시간</h1>
          <p className="mt-2 max-w-[600px] text-[13px] leading-relaxed text-white/45">
            {games}개 게임에서 깬 업적 {total.toLocaleString()}개의 해금 시각과 전 세계 달성률로 그렸습니다. 업적은 플레이 시간이 많은 게임 80개까지 받아 옵니다.
          </p>
        </header>
        <AchievementCalendar graph={graph} />
        <RareShowcase graph={graph} onOpen={onOpenInExplorer} />
        <footer className="mt-6 border-t border-white/[0.06] pt-5 text-[11px] leading-relaxed text-white/35">
          <p>{LEGAL_NOTICE.ko}</p>
          <p className="mt-1.5 text-white/25">{LEGAL_NOTICE.en}</p>
        </footer>
      </div>
    </div>
  );
}
