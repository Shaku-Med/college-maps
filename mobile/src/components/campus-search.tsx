import { useMemo, type ReactNode } from 'react';

import { Greeting } from '@/components/greeting';
import { PlaceResults } from '@/components/place-results';
import { getPlace, type Place } from '@/data/campus';
import { useLocation } from '@/lib/location';

type CampusSearchProps = {
  query: string;
  onPick: (place: Place, room?: string) => void;
  /** Picking a place for a form: a check marks the current choice instead of rows leading somewhere. */
  picking?: boolean;
  selectedId?: string;
  /** The place whose page is open beside the list, highlighted, and what "near" means when there is no location. */
  linkedId?: string | null;
  /** Rows shown first, like "My location". */
  header?: ReactNode;
  hide?: readonly string[];
};

/** The Search tab's results, the same everywhere a place is picked: hello and next class, the closest things, then places. */
export function CampusSearch({ query, onPick, picking, selectedId, linkedId, header, hide }: CampusSearchProps) {
  const here = useLocation().fix?.position;
  const open = linkedId ? getPlace(linkedId) : undefined;
  const nearby = useMemo(() => ({ here, around: open?.isBuilding ? open : undefined }), [here, open]);

  return (
    <>
      {query ? null : <Greeting onOpenClass={onPick} />}
      <PlaceResults
        query={query}
        onPick={onPick}
        picking={picking}
        selectedId={selectedId}
        linkedId={linkedId}
        header={header}
        nearby={nearby}
        hide={hide}
      />
    </>
  );
}
