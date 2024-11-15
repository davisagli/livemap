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

  // persist uid and name
  const [uid] = useState(() => {
    let uid = localStorage.getItem('livemap_uid');
    if (uid === null) {
      uid = uuid();
      localStorage.setItem('livemap_uid', uid);
    }
    return uid;
  });
  const [name] = useState(() => localStorage.getItem('livemap_name') || '');
  const self = useRef({ name });

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
    if (points.length === 0) {
      return;
    }

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
    // connect to websocket
    ws.current = new WebSocket(
      (window.location.hostname === 'localhost'
        ? 'http://localhost:8080'
        : '') + `/ws/livemap/stream?block_id=${block}&user_id=${uid}`,
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
    const trackLocation = () => {
      // get and send current location
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          self.current.location = `${pos.coords.longitude},${pos.coords.latitude}`;
          // todo: only send if it moved significantly
          ws.current.send(JSON.stringify(self.current));
        },
        (error) => console.log(error),
        { maximumAge: 1000, enableHighAccuracy: true },
      );
    };
    let interval = null;
    ws.current.onopen = () => {
      trackLocation();
      interval = setInterval(trackLocation, 5000);
    };
    return () => {
      ws.current.close();
      if (interval) clearInterval(interval);
    };
  }, []);

  useEffect(() => {
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
  }, []);
  return (
    <div className="livemap block">
      <div className="controls">
        <input
          placeholder="Name"
          defaultValue={name}
          onChange={(e) => {
            localStorage.setItem('livemap_name', e.target.value);
            self.current.name = e.target.value;
            ws.current.send(JSON.stringify(self.current));
          }}
        />
      </div>
      <div ref={mapContainer}></div>
    </div>
  );
};

export default View;
