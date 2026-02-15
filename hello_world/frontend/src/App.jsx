import React, { useState, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import * as THREE from 'three'

function PointCloud({ points }) {
  const positions = useMemo(() => {
    if (!points || points.length === 0) return new Float32Array(0);
    
    const pos = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      pos[i * 3] = points[i].x;
      pos[i * 3 + 1] = points[i].y;
      pos[i * 3 + 2] = points[i].z;
    }
    return pos;
  }, [points]);

  if (positions.length === 0) return null;

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute
          key={positions.length} 
          attach="attributes-position"
          count={positions.length / 3}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial size={0.5} color="#00ff00" sizeAttenuation={true} />
    </points>
  );
}

function App() {
  const [count, setCount] = useState(1000);
  const [points, setPoints] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);

  const [offset, setOffset] = useState(0);
  const limit = 10;

  const fetchData = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/hello?count=${count}`);
      const data = await response.json();
      setPoints(data.points || []);
      loadLogs(0); 
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const loadLogs = async (start) => {
    try {
      const response = await fetch(`/logs?start=${start}&limit=${limit}`);
      const data = await response.json();
      setLogs(data.data || []);
      setOffset(start);
      setTotal(data.pagination.total);
    } catch (e) { console.error("Ошибка логов:", e); }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#111', display: 'flex', color: 'white' }}>
      
      <div style={{ width: '350px', borderRight: '1px solid #444', display: 'flex', flexDirection: 'column', padding: '15px', zIndex: 10 }}>
        <h3>Point Cloud Lab</h3>
        
        <label>Количество точек:</label>
        <input type="number" value={count} onChange={(e) => setCount(e.target.value)} />
        <button onClick={fetchData} disabled={loading} style={{ margin: '10px 0' }}>
          {loading ? 'Загрузка...' : 'Сгенерировать'}
        </button>

        <hr style={{ width: '100%', borderColor: '#444' }} />
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4>Логи из MongoDB:</h4>
          <button onClick={() => loadLogs(offset)} style={{ fontSize: '10px' }}>Обновить</button>
        </div>

        {/* СПИСОК ЛОГОВ */}
        <div style={{ flex: 1, overflowY: 'auto', marginTop: '10px', fontSize: '11px', background: '#000', padding: '5px', border: '1px solid #333' }}>
          {logs.map((log, i) => (
            <div key={log._id || i} style={{ marginBottom: '10px', borderBottom: '1px solid #222', paddingBottom: '5px' }}>
              <div style={{ color: '#00ff00', marginBottom: '3px' }}>ID: {log._id}</div>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: '#ccc' }}>
                {JSON.stringify(log.event === 'hello_request' ? { event: log.event, count: log.points_count } : log, null, 2)}
              </pre>
            </div>
          ))}
        </div>

        {/* КНОПКИ ПАГИНАЦИИ */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
          <button 
            disabled={offset === 0} 
            onClick={() => loadLogs(Math.max(0, offset - limit))}
          >
            ← Назад
          </button>
          <span style={{ fontSize: '12px', alignSelf: 'center' }}>Записи: {offset} - {offset + limit}</span>
          <button 
            disabled={offset + logs.length >= total}
            onClick={() => loadLogs(offset + limit)}
          >
            Вперед →
          </button>
        </div>
      </div>

      {/* ПРАВАЯ ЧАСТЬ */}
      <div style={{ flex: 1, position: 'relative' }}>
        <Canvas camera={{ position: [150, 150, 150], fov: 50 }}>
          <color attach="background" args={['#050505']} />
          <PointCloud points={points} />
          <OrbitControls />
          <gridHelper args={[200, 20, 0x444444, 0x222222]} />
        </Canvas>
      </div>

    </div>
  );
}

export default App;