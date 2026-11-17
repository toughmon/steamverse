/**
 * 온톨로지 정의(TBox)와 그래프 인스턴스(ABox)를 Turtle로 직렬화한다.
 * 외부 라이브러리 없이 동작하는 최소 구현 — 정식 내보내기는 n3/jsonld로 교체 예정.
 */
import {
  CLASSES,
  CLASS_ORDER,
  DATA_NS,
  ONTOLOGY_NS,
  PLAY_STATUS,
  RELATIONS,
  RELATION_ORDER,
  type PlayStatus,
} from './ontology';
import type { OntEdge, OntologyGraph } from './graph';

const PREFIXES = `@prefix sv: <${ONTOLOGY_NS}> .
@prefix svd: <${DATA_NS}> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix schema: <https://schema.org/> .`;

function lit(text: string, lang?: string): string {
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  return lang ? `"${escaped}"@${lang}` : `"${escaped}"`;
}

/** 'game:1245620' → 'svd:game-1245620' */
export function nodeIri(nodeId: string): string {
  return `svd:${nodeId.replace(':', '-')}`;
}

const statusIri = (s: PlayStatus) => `sv:${PLAY_STATUS[s].label.en}`;

export function vocabularyTurtle(): string {
  const out: string[] = [PREFIXES, ''];
  out.push(`<${ONTOLOGY_NS}> a owl:Ontology ;`);
  out.push(`    rdfs:label ${lit('Steamverse 게임 라이브러리 온톨로지', 'ko')} .`, '');
  out.push(`sv:inferred a owl:AnnotationProperty ;`);
  out.push(`    rdfs:comment ${lit('규칙으로 계산된 관계임을 표시', 'ko')} .`, '');

  out.push('# ── 클래스 ──');
  for (const id of CLASS_ORDER) {
    const c = CLASSES[id];
    out.push(`sv:${c.id} a owl:Class ;`);
    out.push(`    rdfs:label ${lit(c.label.ko, 'ko')}, ${lit(c.label.en, 'en')} ;`);
    if (c.schemaOrg) out.push(`    owl:equivalentClass ${c.schemaOrg} ;`);
    out.push(`    rdfs:comment ${lit(c.description, 'ko')} .`, '');
  }

  out.push('# ── 관계 ──');
  for (const id of RELATION_ORDER) {
    const r = RELATIONS[id];
    const types = ['owl:ObjectProperty', ...(r.symmetric ? ['owl:SymmetricProperty'] : [])].join(', ');
    out.push(`sv:${r.id} a ${types} ;`);
    out.push(`    rdfs:label ${lit(r.label.ko, 'ko')}, ${lit(r.label.en, 'en')} ;`);
    out.push(`    rdfs:domain sv:${r.domain} ;`);
    out.push(`    rdfs:range sv:${r.range} ;`);
    if (r.schemaOrg) out.push(`    rdfs:subPropertyOf ${r.schemaOrg} ;`);
    if (r.inferred) out.push(`    sv:inferred true ;`);
    out.push(`    rdfs:comment ${lit(r.description, 'ko')} .`, '');
  }

  out.push('# ── 데이터 속성 ──');
  const dataProps: [string, string, string, string][] = [
    ['appid', 'Game', 'xsd:integer', 'Steam 앱 ID'],
    ['playtimeHours', 'Game', 'xsd:decimal', '누적 플레이 시간'],
    ['releaseYear', 'Game', 'xsd:gYear', '출시 연도'],
    ['deckCompatibility', 'Game', 'xsd:string', 'Steam Deck 호환 등급'],
    ['friendSince', 'Player', 'xsd:date', '친구가 된 날'],
  ];
  for (const [name, domain, range, comment] of dataProps) {
    out.push(`sv:${name} a owl:DatatypeProperty ; rdfs:domain sv:${domain} ; rdfs:range ${range} ;`);
    out.push(`    rdfs:comment ${lit(comment, 'ko')} .`);
  }
  out.push('');

  out.push('# ── 플레이 상태 (파생 분류) ──');
  out.push(`sv:PlayStatus a owl:Class ; rdfs:label ${lit('플레이 상태', 'ko')} .`);
  out.push(`sv:playStatus a owl:ObjectProperty ; rdfs:domain sv:Game ; rdfs:range sv:PlayStatus ; sv:inferred true .`);
  for (const s of Object.values(PLAY_STATUS)) {
    out.push(`${statusIri(s.id)} a sv:PlayStatus ; rdfs:label ${lit(s.label.ko, 'ko')} ; rdfs:comment ${lit(s.rule, 'ko')} .`);
  }
  return out.join('\n');
}

function edgeTriple(e: OntEdge): string {
  return `${nodeIri(e.source)} sv:${e.rel} ${nodeIri(e.target)} .`;
}

/** 한 노드를 중심으로 한 Turtle (주어 트리플 + 이 노드를 가리키는 트리플) */
export function nodeTurtle(g: OntologyGraph, nodeId: string, maxIncoming = 12): string {
  const n = g.nodeById.get(nodeId);
  if (!n) return '';
  const props: string[] = [`a sv:${n.cls}`, `rdfs:label ${lit(n.label)}`];
  if (n.game) {
    props.push(`sv:appid ${n.game.appid}`);
    props.push(`sv:playtimeHours ${n.hours.toFixed(1)}`);
    props.push(`sv:releaseYear "${n.game.releaseYear}"^^xsd:gYear`);
    props.push(`sv:playStatus ${statusIri(n.game.status)}`);
    if (n.game.deck !== 'unknown') props.push(`sv:deckCompatibility ${lit(n.game.deck)}`);
  }
  if (n.player?.since) props.push(`sv:friendSince "${n.player.since}"^^xsd:date`);
  if (n.org && n.org.aliases.length > 1) {
    props.push(`rdfs:comment ${lit(`병합된 이름: ${n.org.aliases.join(', ')}`, 'ko')}`);
  }

  const edges = g.adjacency.get(nodeId) ?? [];
  const outgoing = edges.filter((e) => e.source === nodeId);
  const incoming = edges.filter((e) => e.target === nodeId);

  const grouped = new Map<string, string[]>();
  for (const e of outgoing) grouped.set(e.rel, [...(grouped.get(e.rel) ?? []), nodeIri(e.target)]);
  for (const [rel, objs] of grouped) props.push(`sv:${rel} ${objs.join(', ')}`);

  const out = [PREFIXES, '', `${nodeIri(nodeId)}`];
  props.forEach((p, i) => out.push(`    ${p} ${i === props.length - 1 ? '.' : ';'}`));

  if (incoming.length) {
    out.push('', `# 이 노드를 가리키는 관계 (${incoming.length}개${incoming.length > maxIncoming ? `, ${maxIncoming}개만 표시` : ''})`);
    for (const e of incoming.slice(0, maxIncoming)) out.push(edgeTriple(e));
  }
  return out.join('\n');
}
