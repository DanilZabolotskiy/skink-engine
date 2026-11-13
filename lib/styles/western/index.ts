// The western style: a round-headed cartoon — a big round head with dot eyes and simple brows, a thick outline, gradient clothes, thick
// rounded arms and mitten hands. Head: ./head.tsx, body: ./body.tsx.
import type {CharacterStyle} from '../../character/style';
import {westernBody} from './body';
import {HEAD_PIVOT, HEAD_SCALE, westernHead} from './head';

export const western: CharacterStyle = {id: 'western', headScale: HEAD_SCALE, pivot: HEAD_PIVOT, head: westernHead, body: westernBody};
