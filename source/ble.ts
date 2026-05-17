import { SerialManager } from './serial';

export class BLEManager {

  // Global Config Variables
  static serviceUUID = '';
  static charUUID = '';
  static txUUID = ''; 
  static chunkSize = 256;
  static enabled = false;
  static debugMode = false; // Fixes the debugMode error

  public isOpen = false;
  public recording = false;
  public port: any = { isOpen: false }; // Dummy port object to satisfy main.ts
  
  // Device & Power State
  public deviceName: string = 'Unknown';
  public powerState: boolean = false; 
  private txCharacteristic: any = null;

  // Diagnostic Trackers
  public lastFrameTime: number = 0;
  public framesCompleted: number = 0;
  public totalMissedChunks: number = 0;
  public currentFrameMissedChunks: number = 0;
  private expectedNextBin: number = 0;

  // Data Arrays (Changed to number[] to match base interface)
  private bufferPulseData: number[] = Array(SerialManager.adcChannels).fill(0);
  private baseHist: number[] = Array(SerialManager.adcChannels).fill(0);

  // Time Trackers
  private recordStartTime: number = 0;
  private totalRecordedTime: number = 0;

  private device: any;
  private characteristic: any;

  async open(): Promise<void> {
    if (!this.device) {
      if (!(navigator as any).bluetooth) throw new Error('Web Bluetooth not supported');
      this.device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [BLEManager.serviceUUID]
      });

      this.device.addEventListener('gattserverdisconnected', () => {
        console.warn("BLE Device disconnected unexpectedly!");
        window.dispatchEvent(new Event('ble-unexpected-disconnect'));
      });
    }

    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(BLEManager.serviceUUID);
    this.characteristic = await service.getCharacteristic(BLEManager.charUUID);

    this.deviceName = this.device.name || 'Unknown Device';

    try {
      if (BLEManager.txUUID) {
        this.txCharacteristic = await service.getCharacteristic(BLEManager.txUUID);
      }
    } catch (err) {
      console.warn('TX Characteristic not found or invalid UUID.', err);
    }

    this.characteristic.addEventListener('characteristicvaluechanged', (e: Event) => {
      const target = e.target as any;
      if (!target.value || !this.recording) return;

      if ((target.value.byteLength - 2) % 4 !== 0) return;

      let d = new DataView(target.value.buffer);
      let startBin = d.getUint16(0, true);
      let numBins = (target.value.byteLength - 2) / 4;

      if (startBin === 0) {
        this.lastFrameTime = performance.now();
        this.framesCompleted++;
        this.currentFrameMissedChunks = 0;
      } else if (startBin !== this.expectedNextBin) {
        this.totalMissedChunks++;
        this.currentFrameMissedChunks++;
      }
      this.expectedNextBin = startBin + numBins;

      for (let i = 0; i < numBins; i++) {
        const binIndex = startBin + i;
        if (binIndex >= SerialManager.adcChannels) continue; 
      
        const newValue = d.getUint32(2 + (i * 4), true);
        const diff = newValue - this.baseHist[binIndex];
        
        if (diff > 0) {
            this.bufferPulseData[binIndex] += diff;
            this.baseHist[binIndex] = newValue;
        }
      }
    });

    await this.characteristic.startNotifications();
    this.isOpen = true;
    this.port.isOpen = true;
  }

  async togglePower(): Promise<boolean> {
    if (!this.txCharacteristic) return this.powerState;
    this.powerState = !this.powerState;
    const payload = new Uint8Array([this.powerState ? 0x01 : 0x00]);
    await this.txCharacteristic.writeValueWithoutResponse(payload);
    return this.powerState;
  }

  async close(): Promise<void> {
    this.recording = false;
    this.isOpen = false;
    this.port.isOpen = false;
    if (this.characteristic) {
        try {
            await this.characteristic.stopNotifications();
        } catch (e) {
            console.error('Error stopping notifications', e);
        }
    }
    if (this.device && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    }
  }

  isThisPort(): boolean {
    return false; 
  }

  async startRecord(clear: boolean): Promise<void> {
    this.recording = true;
    this.recordStartTime = performance.now();
    if (clear) {
      this.bufferPulseData.fill(0);
      this.baseHist.fill(0);
      this.framesCompleted = 0;
      this.totalMissedChunks = 0;
      this.currentFrameMissedChunks = 0;
      this.totalRecordedTime = 0;
    }
  }

  async stopRecord(): Promise<void> {
    if (this.recording) {
      this.totalRecordedTime += performance.now() - this.recordStartTime;
    }
    this.recording = false;
  }

  // Matches SerialManager interface calls in main.ts
  getData(): number[] {
    const dataCopy = [...this.bufferPulseData];
    this.bufferPulseData.fill(0);
    return dataCopy;
  }

  getTime(): number {
    if (this.recording) return this.totalRecordedTime + (performance.now() - this.recordStartTime);
    return this.totalRecordedTime;
  }

  getBaudRate(): number { return 0; }
  async changeBaudRate(): Promise<void> {}
  async requestPort(): Promise<void> {}
  
  // Synchronous string return to match SerialManager
  getRawData(): string { return ''; }
  async flushRawData(): Promise<void> {}
  
  // Must return promises
  async showConsole(): Promise<void> {}
  async hideConsole(): Promise<void> {}
  async sendString(): Promise<void> {}
}