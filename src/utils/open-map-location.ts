import { Alert, Linking, Platform } from 'react-native';

export type MapLocation = {
  label?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

type OpenMapLocationOptions = {
  source?: string;
  mode?: 'view' | 'directions';
};

function hasCoordinates(location: MapLocation): boolean {
  return (
    typeof location.latitude === 'number' &&
    Number.isFinite(location.latitude) &&
    typeof location.longitude === 'number' &&
    Number.isFinite(location.longitude)
  );
}

function getCoordinateQuery(location: MapLocation): string | undefined {
  if (!hasCoordinates(location)) return undefined;

  return `${location.latitude},${location.longitude}`;
}

function getTextQuery(location: MapLocation): string | undefined {
  const label = location.label?.trim();
  const address = location.address?.trim();

  if (label && address) return `${label}, ${address}`;
  if (address) return address;
  if (label) return label;

  return undefined;
}

function getLocationQuery(location: MapLocation): string | undefined {
  return getCoordinateQuery(location) || getTextQuery(location);
}

function buildGoogleMapsUrl(location: MapLocation, mode: OpenMapLocationOptions['mode']): string {
  const query = getLocationQuery(location);

  if (!query) {
    throw new Error('No map location query is available.');
  }

  const encodedQuery = encodeURIComponent(query);

  if (mode === 'directions') {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodedQuery}`;
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodedQuery}`;
}

function buildAppleMapsUrl(location: MapLocation, mode: OpenMapLocationOptions['mode']): string {
  const coordinateQuery = getCoordinateQuery(location);
  const textQuery = getTextQuery(location);
  const query = coordinateQuery || textQuery;

  if (!query) {
    throw new Error('No map location query is available.');
  }

  const encodedQuery = encodeURIComponent(query);

  if (mode === 'directions') {
    return `http://maps.apple.com/?daddr=${encodedQuery}`;
  }

  return `http://maps.apple.com/?q=${encodedQuery}`;
}

function buildMapUrl(location: MapLocation, mode: OpenMapLocationOptions['mode']): string {
  if (Platform.OS === 'ios') {
    return buildAppleMapsUrl(location, mode);
  }

  return buildGoogleMapsUrl(location, mode);
}

export async function openMapLocation(
  location: MapLocation,
  options: OpenMapLocationOptions = {}
) {
  const source = options.source || 'Map location';
  const mode = options.mode || 'view';

  try {
    const url = buildMapUrl(location, mode);

    await Linking.openURL(url);
  } catch (error) {
    console.warn(`[openMapLocation] failed to open ${source}:`, error);
    Alert.alert(
      'Location unavailable',
      'This location could not be opened in Maps.'
    );
  }
}

export async function openMapDirections(
  location: MapLocation,
  source?: string
) {
  await openMapLocation(location, {
    source,
    mode: 'directions',
  });
}