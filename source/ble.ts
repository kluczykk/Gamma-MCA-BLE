import { SerialManager } from './serial';

export class BLEManager {
  static enabled = false;
  static serviceUUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
  static charUUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
  static txUUID = '';
  static chunkSize = 64;
  static debugMode = false;

  isOpen = false;
  recording = false;
  private device: any | undefined;
  private characteristic: any | undefined;
  
  private baseHist: number[] = [];
  private bufferPulseData: number[] = [];
  private startTime = 0;
  private timeDone = 0;
  
  // Device & Control
  public deviceName: string = 'Unknown';
  public powerState: boolean = false; 
  private txCharacteristic: any = null;
  
  // Diagnostics
  public lastFrameTime: number = 0;
  public framesCompleted: number = 0;
  public totalMissedChunks: number = 0;
  public currentFrameMissedChunks: number = 0;
  private expectedNextBin: number = 0

  async open(): Promise<void> {
    if (!this.device) {
      if (!(navigator as any).bluetooth) throw new Error('Web Bluetooth not supported');
      this.device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [BLEManager.serviceUUID]
      });
    }
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(BLEManager.serviceUUID);
    this.characteristic = await service.getCharacteristic(BLEManager.charUUID);

	// Get device name
	this.deviceName = this.device.name || 'Unknown Device';
	
	// Attempt to connect to TX Characteristic
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

// --- DIAGNOSTICS LOGIC ---
      if (startBin === 0) {
        this.lastFrameTime = performance.now();
        this.framesCompleted++;
        this.currentFrameMissedChunks = 0;
      } else if (startBin !== this.expectedNextBin) {
        this.totalMissedChunks++;
        this.currentFrameMissedChunks++;
      }
      this.expectedNextBin = startBin + numBins;
      // -------------------------
	  
      for (let i = 0; i < numBins; i++) {
        const binIndex = startBin + i;
        
        // Drop data that exceeds the set ADC channels
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
  }

  async close(): Promise<void> {
    this.isOpen = false;
    this.recording = false;
    try {
        await this.characteristic?.stopNotifications();
        this.device?.gatt?.disconnect();
    } catch(e) {}
  }

  async startRecord(resume = false): Promise<void> {
    if (!this.isOpen) await this.open();
    if (!resume) {
      this.bufferPulseData = Array(SerialManager.adcChannels).fill(0);
	  this.baseHist = Array(SerialManager.adcChannels).fill(0);
      this.timeDone = 0;
    }
    this.startTime = performance.now();
    this.recording = true;
  }

  async stopRecord(): Promise<void> {
    this.recording = false;
    this.timeDone += performance.now() - this.startTime;
  }

  getData(): number[] {
    const copyArr = [...this.bufferPulseData];
    this.bufferPulseData = Array(SerialManager.adcChannels).fill(0);
    return copyArr;
  }

  async togglePower(): Promise<boolean> {
    if (!this.txCharacteristic) return this.powerState;
    this.powerState = !this.powerState;
    const payload = new Uint8Array([this.powerState ? 0x01 : 0x00]);
    await this.txCharacteristic.writeValueWithoutResponse(payload);
    return this.powerState;
  }
  getTime(): number {
    return (this.recording ? (performance.now() - this.startTime + this.timeDone) : this.timeDone);
  }
  
  // --- Interface Stubs for SerialManager Compatibility ---
  port: any = null;

  isThisPort(portToCheck: any): boolean {
    return false; 
  }

  flushRawData(): void {
    // Do nothing
  }

  hideConsole(): void {
    // Do nothing
  }

  showConsole(): void {
    // Do nothing
  }

  sendString(str: string): void {
    // Do nothing (BLE TX not implemented yet)
  }

  getRawData(): string {
    return ''; 
  }
  
}