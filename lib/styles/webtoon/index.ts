// The webtoon style: webtoon proportions (5–6 heads tall), an egg-shaped face with a jaw, iris eyes and thin brows, hair as
// a mass of strands, a thin outline, flat fills with one step of shade, detailed hands for every grip. Head: ./head.tsx,
// body: ./body.tsx, hands: ./hands.tsx.
import type {CharacterStyle} from '../../character/style';
import {webtoonBody} from './body';
import {HEAD_PIVOT, HEAD_SCALE, webtoonHead} from './head';

export const webtoon: CharacterStyle = {id: 'webtoon', headScale: HEAD_SCALE, pivot: HEAD_PIVOT, head: webtoonHead, body: webtoonBody};
