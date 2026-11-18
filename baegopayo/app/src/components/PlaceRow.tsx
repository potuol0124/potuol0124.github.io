import { ListRow } from '@toss/tds-mobile';
import { STYLE_BY_ID, formatDistance, walkMinutes } from '../lib/styles';
import type { Place } from '../lib/types';

interface Props {
  place: Place;
  highlighted?: boolean;
  onOpen: (place: Place) => void;
}

export function PlaceRow({ place, highlighted, onOpen }: Props) {
  const emoji = place.style ? STYLE_BY_ID[place.style].emoji : '🍽️';
  const meta = `${place.category} · ${formatDistance(place.distance)} · 도보 ${walkMinutes(place.distance)}분`;

  return (
    <ListRow
      id={`place-${place.id}`}
      className={highlighted ? 'place-row highlighted' : 'place-row'}
      left={
        <span className="place-emoji" aria-hidden>
          {emoji}
        </span>
      }
      contents={<ListRow.Texts type="2RowTypeA" top={place.name} bottom={meta} />}
      right={
        place.rating != null ? (
          <span className="place-rating" aria-label={`별점 ${place.rating}점, 리뷰 ${place.ratingCount ?? 0}개`}>
            <span className="star">★</span> {place.rating.toFixed(1)}
            {place.ratingCount != null && <span className="count">({place.ratingCount.toLocaleString()})</span>}
          </span>
        ) : undefined
      }
      arrowType="right"
      withTouchEffect
      onClick={() => onOpen(place)}
    />
  );
}
