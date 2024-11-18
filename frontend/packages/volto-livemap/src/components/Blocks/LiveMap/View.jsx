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
    const points = Object.values(visitors.current);
    const features = {
      type: 'FeatureCollection',
      features: points.map((visitor) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: visitor.coordinates,
        },
        properties: visitor.properties,
      })),
    };

    const map = mapref.current;
    const source = map.getSource('visitors');
    if (source) {
      source.setData(features);
    } else {
      if (points.length) {
        const bounds = features.features.reduce(
          (bounds, feature) => bounds.extend(feature.geometry.coordinates),
          new maplibregl.LngLatBounds(),
        );
        map.fitBounds(bounds, { maxZoom: 12, padding: 30 });
      }
      map.addSource('visitors', {
        type: 'geojson',
        data: features,
      });
      map.addLayer({
        id: 'dots',
        type: 'circle',
        source: 'visitors',
        paint: {
          'circle-radius': 10,
          'circle-blur': 0.5,
          'circle-color': '#008080',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
          'circle-opacity': ['get', 'opacity'],
        },
      });
      map.addLayer({
        id: 'labels',
        type: 'symbol',
        source: 'visitors',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-offset': [0.6, 0],
          'text-allow-overlap': true,
          'text-anchor': 'left',
        },
        paint: {
          'text-color': '#008080',
          'text-opacity': ['get', 'opacity'],
        },
      });
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
        : '') + `/ws/livemap/stream?block_id=${block}&uid=${self.current.uid}`,
    );
    ws.current.onmessage = (m) => {
      const visitor = JSON.parse(m.data);
      console.log(visitor);
      if (
        visitor.uid === self.current.uid &&
        visitor.name &&
        visitor.name !== self.current.name
      ) {
        save({ name: visitor.name });
      }
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
