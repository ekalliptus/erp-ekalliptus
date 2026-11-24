import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef } from 'react';

interface OfficeMapPickerProps {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  onPick: (lat: number, lng: number) => void;
  heightClassName?: string;
}

const PIN_ICON = L.divIcon({
  className: 'ekalliptus-office-pin',
  html: '<div style="width:20px;height:20px;border-radius:9999px;background:#0F766E;border:3px solid #FFFFFF;box-shadow:0 2px 8px rgba(0,0,0,0.35);"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

export function OfficeMapPicker({
  latitude,
  longitude,
  radiusMeters,
  onPick,
  heightClassName = 'h-64',
}: OfficeMapPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      center: [latitude, longitude],
      zoom: 16,
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const marker = L.marker([latitude, longitude], {
      icon: PIN_ICON,
      draggable: true,
    }).addTo(map);

    const circle = L.circle([latitude, longitude], {
      radius: radiusMeters,
      color: '#0F766E',
      fillColor: '#14B8A6',
      fillOpacity: 0.16,
      weight: 2,
    }).addTo(map);

    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      onPickRef.current(Number(pos.lat.toFixed(6)), Number(pos.lng.toFixed(6)));
    });

    map.on('click', (e: L.LeafletMouseEvent) => {
      onPickRef.current(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)));
    });

    const timer = window.setTimeout(() => map.invalidateSize(), 160);
    mapRef.current = map;
    markerRef.current = marker;
    circleRef.current = circle;

    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
    // Map initializes once per mounted drawer/panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    const circle = circleRef.current;
    if (!map || !marker || !circle) return;

    const nextLatLng = L.latLng(latitude, longitude);
    const prevLatLng = marker.getLatLng();
    marker.setLatLng(nextLatLng);
    circle.setLatLng(nextLatLng);
    circle.setRadius(radiusMeters);

    if (prevLatLng.distanceTo(nextLatLng) > 50) {
      map.setView(nextLatLng, map.getZoom(), { animate: true });
    }
  }, [latitude, longitude, radiusMeters]);

  return (
    <div className="space-y-1.5">
      <div
        ref={containerRef}
        className={`${heightClassName} w-full overflow-hidden rounded-lg border border-border-strong z-0`}
        aria-label="Peta pilih koordinat kantor"
      />
      <p className="text-[11px] text-text-secondary">
        Ketuk peta atau geser pin untuk menentukan titik pusat kantor & lingkaran radius.
      </p>
    </div>
  );
}
