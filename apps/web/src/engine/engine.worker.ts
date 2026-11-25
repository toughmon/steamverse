/**
 * 그래프 엔진 Worker. Comlink로 init/view 두 가지를 내준다.
 * 숫자 배열은 transfer(복사 없이 소유권 이동)로 넘긴다.
 */
import * as Comlink from 'comlink';
import { GraphEngine } from './core';
import type { EngineApi, EngineSource } from './protocol';
import type { ViewQuery } from '../views/explorer/visible';

const engine = new GraphEngine();

const api: EngineApi = {
  async init(source: EngineSource) {
    const { payload, transfer } = engine.init(source);
    return Comlink.transfer(payload, transfer);
  },
  async view(query: ViewQuery) {
    const { result, transfer } = engine.view(query);
    return Comlink.transfer(result, transfer);
  },
};

Comlink.expose(api);
