import { useEffect, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './map.css';

const View = (props) => {
  const { block } = props;

  const mapContainer = useRef(null);
  const mapref = useRef(null);
  const visitors = useRef({});
  const ws = useRef(null);
  const [offset] = useState({
    longitude: Math.random() * 0.032 - 0.016,
    latitude: Math.random() * 0.032 - 0.016,
  });
  const [share, setShare] = useState('yes');

  const self = useRef({});
  const save = (changes) => {
    self.current = { ...self.current, ...changes };
    localStorage.setItem('livemap_self', JSON.stringify(self.current));
  };

  const updateMap = () => {
    const othersVisitors = Object.values(visitors.current).filter(
      (visitor) => visitor.properties.uid !== self.current.uid,
    );
    const othersGeojson = {
      type: 'FeatureCollection',
      features: othersVisitors.map((visitor) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: visitor.coordinates,
        },
        properties: visitor.properties,
      })),
    };
    const selfGeojson = {
      type: 'FeatureCollection',
      features: self.current.location
        ? [
            {
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: self.current.location.split(','),
              },
              properties: {
                name: self.current.name,
                opacity: 1,
              },
            },
          ]
        : [],
    };

    const map = mapref.current;
    const othersSource = map.getSource('others');
    const selfSource = map.getSource('self');
    const circlePaint = {
      'circle-radius': 10,
      'circle-blur': 0.5,
      'circle-color': '#008080',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff',
      'circle-opacity': ['get', 'opacity'],
    };
    const textLayout = {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Regular'],
      'text-offset': [0.6, 0],
      'text-allow-overlap': true,
      'text-anchor': 'left',
    };
    const textPaint = {
      'text-color': '#008080',
      'text-opacity': ['get', 'opacity'],
    };
    if (othersSource) {
      othersSource.setData(othersGeojson);
    } else {
      map.addSource('others', {
        type: 'geojson',
        data: othersGeojson,
      });
      map.addLayer({
        id: 'others-dots',
        type: 'circle',
        source: 'others',
        paint: circlePaint,
      });
      map.addLayer({
        id: 'others-labels',
        type: 'symbol',
        source: 'others',
        layout: textLayout,
        paint: textPaint,
      });
    }
    if (selfSource) {
      selfSource.setData(selfGeojson);
    } else {
      map.addSource('self', {
        type: 'geojson',
        data: selfGeojson,
      });
      map.addLayer({
        id: 'self-dots',
        type: 'circle',
        source: 'self',
        paint: { ...circlePaint, 'circle-color': '#c00000' },
      });
      map.addLayer({
        id: 'self-labels',
        type: 'symbol',
        source: 'self',
        layout: textLayout,
        paint: { ...textPaint, 'text-color': '#c00000' },
      });
      let radius = 1;
      const animateSelf = (timestamp) => {
        setTimeout(() => {
          requestAnimationFrame(animateSelf);
          radius += 1;
          if (radius > 10) {
            radius = 5;
          }
          map.setPaintProperty('self-dots', 'circle-radius', radius);
        }, 1000 / 10);
      };
      requestAnimationFrame(animateSelf);
    }
    const bounds = new maplibregl.LngLatBounds();
    othersGeojson.features.forEach((feature) =>
      bounds.extend(feature.geometry.coordinates),
    );
    selfGeojson.features.forEach((feature) =>
      bounds.extend(feature.geometry.coordinates),
    );
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { maxZoom: 12, padding: 30 });
    }
  };

  useEffect(() => {
    // get self from localstorage
    let data = localStorage.getItem('livemap_self');
    const defaults = { uid: uuid(), name: '', share: 'yes' };
    self.current = {
      ...defaults,
      ...(data ? JSON.parse(data) : {}),
      location: null,
    };
    setShare(self.current.share);

    // connect to websocket
    ws.current = new WebSocket(
      (window.location.hostname === 'localhost'
        ? 'http://localhost:8080'
        : '') +
        `/ws/livemap/stream?block_id=${block}&user_id=${self.current.uid}`,
    );
    ws.current.onmessage = (m) => {
      const visitor = JSON.parse(m.data);
      console.log(visitor);
      if (visitor.location) {
        visitors.current[visitor.uid] = {
          coordinates: visitor.location.split(','),
          properties: { ...visitor, opacity: visitor.active ? 1 : 0.4 },
        };
      } else {
        delete visitors.current[visitor.uid];
      }
      if (mapref.current.ready) {
        updateMap();
      }
    };

    // initialize map
    const map = (mapref.current = new maplibregl.Map({
      container: mapContainer.current,
      projection: 'globe',
      zoom: 8,
      center: [-122.333, 47.606],
      style: 'https://tiles.openfreemap.org/styles/liberty',
    }));
    map.on('load', async () => {
      mapref.current.ready = true;
      updateMap();
    });
    return () => ws.current.close();
  }, [block]);

  useEffect(() => {
    // track location
    const trackLocation = () => {
      if (ws.current === null || ws.current.readyState !== WebSocket.OPEN) {
        return;
      }
      if (share === 'no') {
        self.current.location = null;
        ws.current.send(
          JSON.stringify({
            uid: self.current.uid,
            name: self.current.name,
            location: null,
          }),
        );
      } else {
        // get and send current location
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const location =
              share === 'fuzzy'
                ? `${pos.coords.longitude + offset.longitude},${pos.coords.latitude + offset.latitude}`
                : `${pos.coords.longitude},${pos.coords.latitude}`;
            if (location !== self.current.location) {
              self.current.location = location;
              ws.current.send(
                JSON.stringify({
                  uid: self.current.uid,
                  name: self.current.name,
                  location,
                }),
              );
            }
          },
          (error) => console.log(error),
          { maximumAge: 1000, enableHighAccuracy: true },
        );
      }
    };
    trackLocation();
    ws.current.onopen = () => trackLocation();
    if (share !== 'no') {
      let interval = setInterval(trackLocation, 5000);
      return () => clearInterval(interval);
    }
  }, [offset, share]);

  return (
    <div className="livemap block">
      <form className="controls ui form">
        <div className="field">
          <input
            type="text"
            autoComplete="false"
            placeholder="Enter your name"
            defaultValue={self.current.name}
            onChange={(e) => {
              save({ name: e.target.value });
              ws.current.send(JSON.stringify(self.current));
            }}
          />
        </div>
        <div className="field">
          <label>Share location?</label>
          <input
            type="radio"
            checked={share === 'yes'}
            onChange={() => {
              setShare('yes');
              save({ share: 'yes' });
            }}
          />{' '}
          Yes{' '}
          <input
            type="radio"
            checked={share === 'no'}
            onChange={() => {
              setShare('no');
              save({ share: 'no' });
            }}
          />{' '}
          No{' '}
          <input
            type="radio"
            checked={share === 'fuzzy'}
            onChange={() => {
              setShare('fuzzy');
              save({ share: 'fuzzy' });
            }}
          />{' '}
          Fuzzy
        </div>
      </form>
      <div ref={mapContainer}></div>
    </div>
  );
};

export default View;
