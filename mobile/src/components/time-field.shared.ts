export type TimeFieldProps = {
  /** Minutes since midnight. */
  minutes: number;
  onChange: (minutes: number) => void;
};

export function fromMinutes(minutes: number) {
  const date = new Date();
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
}

export const toMinutes = (date: Date) => date.getHours() * 60 + date.getMinutes();
