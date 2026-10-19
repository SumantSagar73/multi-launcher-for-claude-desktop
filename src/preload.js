'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  // Known before the first paint, so the title bar can be laid out for the right platform straight away.
  platform: process.platform,
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('state', handler);
    return () => ipcRenderer.removeListener('state', handler);
  },
  action: (name, payload) => ipcRenderer.invoke('action', name, payload),
});
