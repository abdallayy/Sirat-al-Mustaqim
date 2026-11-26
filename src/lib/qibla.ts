export type Coordinates = {
  latitude: number;
  longitude: number;
};

const KAABA: Coordinates = { latitude: 21.422487, longitude: 39.826206 };
const radians = Math.PI / 180;

export function qiblaBearing(location: Coordinates): number {
  if (!Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90) {
    throw new RangeError("Latitude must be between -90 and 90 degrees.");
  }
  if (!Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180) {
    throw new RangeError("Longitude must be between -180 and 180 degrees.");
  }
  if (location.latitude === KAABA.latitude && location.longitude === KAABA.longitude) return 0;

  const latitude = location.latitude * radians;
  const kaabaLatitude = KAABA.latitude * radians;
  const longitudeDifference = (KAABA.longitude - location.longitude) * radians;
  const y = Math.sin(longitudeDifference);
  const x =
    Math.cos(latitude) * Math.tan(kaabaLatitude) -
    Math.sin(latitude) * Math.cos(longitudeDifference);
  return (Math.atan2(y, x) / radians + 360) % 360;
}

export function hijriDateLabel(date: Date): string | null {
  try {
    return new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  } catch {
    return null;
  }
}
