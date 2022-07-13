// Copyright Code Mercenaries GmbH, www.codemercs.com
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.


module.exports = function (RED) {

	'use strict';

	//Some defines
	const DALI_MODE_DACP = 0x00;
	const DALI_MODE_CMD = 0x01;
	const DALI_ADR_GROUP = 0x80;
	const DALI_ADR_SHORT = 0x00;

	//Some settings for LW14
	const LW14_I2C = 0x40;          //8Bit address
	const LW14_REG_STATUS = 0x00;   //Status register
	const LW14_REG_CMD = 0x01;      //Command register

	//Answers of 'status' register
	const LW14_STATE_NONE = 0x00;
	const LW14_STATE_1BYTE = 0x01;
	const LW14_STATE_2BYTE = 0x02;
	const LW14_STATE_TIMEFRAME = 0x04;
	const LW14_STATE_VALID = 0x08;
	const LW14_STATE_FRAMEERROR = 0x10;
	const LW14_STATE_OVERRUN = 0x20;
	const LW14_STATE_BUSY = 0x40;
	const LW14_STATE_BUS_FAULT = 0x80;

	//Error codes for return messge 
	const ERROR_NONE = 0x00;
	const ERROR_NO_DEVICE = 0x01;
	const ERROR_BUS_BUSY = 0x02;
	const ERROR_BUS_FAULT = 0x04;
	const ERROR_INPUT = 0x08;
	const ERROR_BUS_ERROR = 0x10;

	//Error flags for input check
	const ERROR_INPUT_NONE = 0x00;
	const ERROR_INPUT_MODE = 0x01;
	const ERROR_INPUT_TYPE = 0x02;
	const ERROR_INPUT_ADR = 0x04;
	const ERROR_INPUT_VALUE = 0x08;
	const ERROR_INPUT_FORMAT = 0x10;

	//Build the message to handle errors
	function error_json(message, code) {
		var obj = {
			payload: {
				type: "error",
				code: code,
				msg: message
			}
		};
		return obj;
	}

	//Build the message which stores the return values of a single device
	function data_json(device, query, size, data) {
		var obj = {
			payload: {
				adr: device,	//DALI address in "real" 0..63
				query: query,		//Query asked for
				size: size,			//1: 8Bit /2: 16Bit /3: 24Bit telegram
				data: data			//Data array, size based on telegram count
			}
		};
		return obj;
	}

	function lw14udr_send(n) {
		RED.nodes.createNode(this, n);
		this.name = n.name;
		this.serial = n.serial;		//Serial number as <string>
		this.data_in = n.data_in || "payload";

		var node = this;

		node.on("input", function (msg) {

			var dali_adr = 0x00;     //BYTE, unsigned char
			var dali_value = 0x00;   //BYTE, unsigned char
			var dali_type = 0x00;
			var dali_mode = 0x00;
			var value = RED.util.getMessageProperty(msg, node.data_in);
			var obj;
			var msg = {};
			var bus_error = 0x00;
			var input_error = ERROR_INPUT_NONE;

			if (value !== undefined) {
				//Check for valid input format STRING or JSON
				if (typeof value === "string" || Buffer.isBuffer(value))
					obj = JSON.parse(value);
				else if (typeof value === "object")
					obj = JSON.parse(JSON.stringify(value));
				else {
					input_error |= ERROR_INPUT_FORMAT;
				}

				if (input_error == ERROR_INPUT_NONE) {
					//Mode: DACP or Command
					if (typeof obj.mode === "number") {
						if ((obj.mode >= 0) && (obj.mode <= 1))
							dali_mode = obj.mode;
						else
							input_error |= ERROR_INPUT_MODE;
					}
					else
						input_error |= ERROR_INPUT_MODE;

					//Type: single, group, broadcast
					if (typeof obj.type === "number") {
						if ((obj.type >= 0) && (obj.type <= 2))
							dali_type = obj.type;
						else
							input_error |= ERROR_INPUT_TYPE;
					}
					else
						input_error |= ERROR_INPUT_TYPE;

					//Device address: 0..63 or group: 0..15
					if (typeof obj.adr === "number") {
						if ((obj.adr >= 0) && (obj.adr <= 63))
							dali_adr = obj.adr;
						else
							input_error |= ERROR_INPUT_ADR;
					}
					else
						input_error |= ERROR_INPUT_ADR;

					//DALI value 0..254 (255 is used for MASK)
					if (typeof obj.value === "number") {
						if ((obj.value >= 0) && (obj.value <= 254))
							dali_value = obj.value;
						else
							input_error |= ERROR_INPUT_VALUE;
					}
					else
						input_error |= ERROR_INPUT_VALUE;


					//Show Error Messages
					if (input_error != ERROR_INPUT_NONE) {
						if ((input_error & ERROR_INPUT_MODE) == ERROR_INPUT_MODE)
							node.send(error_json("Mode must be a 'number' (0: DACP, 1: Command)", ERROR_INPUT));

						if ((input_error & ERROR_INPUT_TYPE) == ERROR_INPUT_TYPE)
							node.send(error_json("Type must be a 'number' (0: broadcast, 1: group, 2: single)", ERROR_INPUT));

						if ((input_error & ERROR_INPUT_ADR) == ERROR_INPUT_ADR)
							node.send(error_json("Address must be a 'number' (broadcast: 0, group: 0..15, single: 0..63)", ERROR_INPUT));

						if ((input_error & ERROR_INPUT_VALUE) == ERROR_INPUT_VALUE)
							node.send(error_json("Value must be a 'number' (0..254)", ERROR_INPUT));

						if ((input_error & ERROR_INPUT_FORMAT) == ERROR_INPUT_FORMAT)
							node.send(error_json("JSON format not supported. Use 'string' or 'json' for inject", ERROR_INPUT));

						node.status({ fill: "yellow", shape: "dot", text: "Input format error" });
					}
				}
				else {
					node.send(error_json("JSON format not supported. Use 'string' or 'json' for inject", ERROR_INPUT));
					node.status({ fill: "yellow", shape: "dot", text: "Input format error" });
					input_error |= ERROR_INPUT_FORMAT;
				}
			}
			else {
				node.send(error_json("JSON format not supported. Use 'string' or 'json' for inject", ERROR_INPUT));
				node.status({ fill: "yellow", shape: "dot", text: "Input format error" });
				input_error |= ERROR_INPUT_FORMAT;
			}

			if (input_error == ERROR_INPUT_NONE) {
				var hid = require('node-hid');
				hid.setDriverType("libusb");	//use libusb instead of hidraw
				var devices = hid.devices();

				var deviceInfo = devices.find(function (d) {
					if (d.vendorId === 0x07C0)
						if (d.productId === 0x1501)
							if (d.serialNumber === n.serial.toUpperCase())
								//Need only access to interface 1 (speial mode -> i2c)
								if (d.interface === 1)
									return d.path && d.serialNumber;
					return null;
				});

				node.status({ fill: "grey", shape: "dot", text: "Pending" });

				if (deviceInfo == null) {
					var message = "LED-Warrior14UDR not found with serial: " + n.serial;
					node.send(error_json(message, ERROR_INPUT));
					node.status({ fill: "red", shape: "dot", text: "Device Offline" });
				}
				else {
					if (deviceInfo.path != "") {
						var dev = new hid.HID(deviceInfo.path);

						//Get valid DALI address
						if (dali_type == 0) dali_adr = DALI_ADR_GROUP | 0xFE | dali_mode;                         //Broadcast
						if (dali_type == 1) dali_adr = DALI_ADR_GROUP | ((dali_adr << 1) & 0xFE) | dali_mode;     //Group
						if (dali_type == 2) dali_adr = DALI_ADR_SHORT | ((dali_adr << 1) & 0xFE) | dali_mode;     //Short

						//init i2c (required once)
						dev.write([0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

						bus_error = 0x00;
						while (1) {
							try {
								dev.write([0x03, 0x01, LW14_I2C | 0x01, 0, 0, 0, 0, 0]);		//Init read status register
								var status = dev.readSync();
								//console.log("Status:" + status[2]);

								if ((status[2] & LW14_STATE_BUS_FAULT) == LW14_STATE_BUS_FAULT) {
									node.send(error_json("Bus is faulty", ERROR_BUS_FAULT));
									bus_error |= 0x01;
									break;
								}
								if ((status[2] & LW14_STATE_BUSY) != LW14_STATE_BUSY) {
									break;
								}
							}
							catch (error) {
								console.log(error.name + " : " + error.message);
								node.error(error.message, msg);
								bus_error |= 0x02;
								break;
							}
						}

						//Send data only if bus is OK
						if (bus_error == 0x00) {
							var wByte = dev.write([0x02, 0xC4, LW14_I2C, LW14_REG_CMD, dali_adr, dali_value, 0x00, 0x00]);	//write data
							var rByte = dev.readSync();	//read ack report
							node.send(error_json("null", ERROR_NONE));
							node.status({ fill: "green", shape: "dot", text: "Success" });
						}
						else {
							node.status({ fill: "red", shape: "dot", text: "Bus Error" });
						}

						dev.close();
					}
				}
			}
			else {
				node.status({ fill: "yellow", shape: "dot", text: "Input format error" });
			}
		});

		node.on('close', function () {
			node.device.close();
		});

	}
	RED.nodes.registerType("send", lw14udr_send);

	function lw14udr_receive(n) {
		RED.nodes.createNode(this, n);
		this.name = n.name;
		this.serial = n.serial;		//Serial number as <string>
		this.data_in = n.data_in || "payload";

		var node = this;

		node.on("input", function (msg) {
			var dali_adr = 0x00;     	//BYTE, unsigned char
			var dali_adr_org = 0x00;	//Copy of DALI address, before build a valid address (Y AAA AAA S)
			var dali_value = 0x00;   	//BYTE, unsigned char
			var value = RED.util.getMessageProperty(msg, node.data_in);
			var obj;
			var bus_error = 0x00;
			var input_error = ERROR_INPUT_NONE;
			var telegram_size = 0;

			if (value !== undefined) {
				if (typeof value === "string" || Buffer.isBuffer(value))
					obj = JSON.parse(value);
				else if (typeof value === "object")
					obj = JSON.parse(JSON.stringify(value));
				else {
					input_error |= ERROR_INPUT_FORMAT;
				}

				if (input_error == ERROR_INPUT_NONE) {
					//Device address: 0..63 or group: 0..15
					if (typeof obj.adr === "number") {

						if ((obj.adr >= 0) && (obj.adr <= 63)) {
							dali_adr_org = obj.adr; //for output
							dali_adr = obj.adr;
						}
						else
							input_error |= ERROR_INPUT_ADR;
					}
					else
						input_error |= ERROR_INPUT_ADR;

					//DALI value 0..254 (255 is used for MASK)
					if (typeof obj.value === "number") {
						if ((obj.value >= 0) && (obj.value <= 254))
							dali_value = obj.value;
						else
							input_error |= ERROR_INPUT_VALUE;
					}
					else
						input_error |= ERROR_INPUT_VALUE;

					if (input_error != ERROR_INPUT_NONE) {
						if ((input_error & ERROR_INPUT_ADR) == ERROR_INPUT_ADR)
							node.send(error_json("Address must be a 'number' (0..63)", ERROR_INPUT));

						if ((input_error & ERROR_INPUT_VALUE) == ERROR_INPUT_VALUE)
							node.send(error_json("Value must be a 'number' (0..254)", ERROR_INPUT));

						if ((input_error & ERROR_INPUT_FORMAT) == ERROR_INPUT_FORMAT)
							node.send(error_json("JSON format not supported. Use 'string' or 'json' for inject", ERROR_INPUT));

						node.status({ fill: "yellow", shape: "dot", text: "Input format error" });
					}
				}
				else {
					node.send(error_json("JSON format not supported. Use 'string' or 'json' for inject", ERROR_INPUT));
					node.status({ fill: "yellow", shape: "dot", text: "Input format error" });
					input_error |= ERROR_INPUT_FORMAT;
				}
			}
			else {
				node.send([error_json("JSON format not supported. Use 'string' or 'json' for inject", ERROR_INPUT), data_json(-1, -1, -1)]);
				node.status({ fill: "yellow", shape: "dot", text: "Input format error" });
				input_error |= ERROR_INPUT_FORMAT;
			}


			if (input_error == ERROR_INPUT_NONE) {
				var hid = require('node-hid');
				hid.setDriverType("libusb");	//use libusb instead of hidraw
				var devices = hid.devices();

				var deviceInfo = devices.find(function (d) {
					if (d.vendorId === 0x07C0)
						if (d.productId === 0x1501)
							if (d.serialNumber === n.serial.toUpperCase())
								//Need only access to interface 1 (speial mode -> i2c)
								if (d.interface === 1)
									return d.path && d.serialNumber;
					return null;
				});

				node.status({ fill: "grey", shape: "dot", text: "Pending" });

				if (deviceInfo == null) {
					var message = "LED-Warrior14UDR not found with serial: " + n.serial;
					node.send([error_json(message, ERROR_INPUT), data_json(-1, -1, -1)]);
					node.status({ fill: "red", shape: "dot", text: "Device Offline" });
				}
				else {
					if (deviceInfo.path != "") {
						var dev = new hid.HID(deviceInfo.path);

						//Get valid DALI address for QUERYs
						dali_adr = DALI_ADR_SHORT | ((dali_adr << 1) & 0xFE) | DALI_MODE_CMD;

						//init i2c (required once)
						dev.write([0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

						//Check bus for ready
						dev.write([0x02, 0xC2, LW14_I2C, LW14_REG_STATUS, 0, 0, 0, 0]);	//Set address pointer at status register
						dev.readSync(); //swallow ACK

						bus_error = 0x00;
						while (1) {
							try {
								dev.write([0x03, 0x01, LW14_I2C | 0x01, 0, 0, 0, 0, 0]);		//Init read status register
								var status = dev.readSync();

								if ((status[2] & LW14_STATE_BUS_FAULT) == LW14_STATE_BUS_FAULT) {
									node.send([error_json("Bus is faulty.", ERROR_BUS_FAULT), data_json(-1, -1, -1)]);
									bus_error |= 0x01;
									break;
								}
								if ((status[2] & LW14_STATE_BUSY) != LW14_STATE_BUSY) {
									break;
								}
							}
							catch (error) {
								console.log(error.name + " : " + error.message);
								node.error(error.message, [msg, 0]);
								bus_error |= 0x02;
								break;
							}
						}

						if (bus_error == 0x00) {
							//Send telegram to get query value
							var wByte = dev.write([0x02, 0xC4, LW14_I2C, LW14_REG_CMD, dali_adr, dali_value, 0x00, 0x00]);
							var rByte = dev.readSync();

							//Wait for reply
							dev.write([0x02, 0xC2, LW14_I2C, LW14_REG_STATUS, 0, 0, 0, 0]);	//Set address pointer at status register
							dev.readSync(); //swallow ACK

							bus_error = 0x00;
							while (1) {
								try {
									dev.write([0x03, 0x01, LW14_I2C | 0x01, 0, 0, 0, 0, 0]);		//Init read status register
									var status = dev.readSync();

									if ((status[2] & LW14_STATE_BUS_FAULT) == LW14_STATE_BUS_FAULT) {
										node.send([error_json("Bus is faulty.", ERROR_BUS_FAULT), data_json(-1, -1, -1)]);
										bus_error |= 0x01;
										break;
									}

									if ((status[2] & LW14_STATE_VALID) == LW14_STATE_VALID) {
										if (((status[2] & LW14_STATE_1BYTE) == LW14_STATE_1BYTE) ||
											((status[2] & LW14_STATE_2BYTE) == LW14_STATE_2BYTE) ||
											((status[2] & (LW14_STATE_1BYTE | LW14_STATE_2BYTE)) == (LW14_STATE_1BYTE | LW14_STATE_2BYTE))) {
											telegram_size = status[2] & 0x03;
											break;
										}
									}
								}
								catch (error) {
									console.log(error.name + " : " + error.message);
									node.error(error.message, [msg, 0]);
									bus_error |= 0x02;
									break;
								}
							}

							if (bus_error == 0x00) {
								dev.write([0x02, 0xC2, LW14_I2C, LW14_REG_CMD, 0, 0, 0, 0]);	//Set address pointer at status register
								dev.readSync(); //swallow ACK

								//Read query value
								var wByte1 = dev.write([0x03, telegram_size, (LW14_I2C | 0x01), LW14_REG_CMD, 0x00, 0x00, 0x00, 0x00]);
								var rByte1 = dev.readSync();

								var data = {};
								if (telegram_size == 1)
									data[0] = rByte1[2];

								if (telegram_size == 2) {
									data[0] = rByte1[2];
									data[1] = rByte1[3];
								}

								if (telegram_size == 3) {
									data[0] = rByte1[2];
									data[1] = rByte1[3];
									data[2] = rByte1[4];
								}

								node.send([error_json("null", ERROR_NONE), data_json(dali_adr_org, dali_value, telegram_size, data)]);
								node.status({ fill: "green", shape: "dot", text: "Success" });
							}
							else {
								node.status({ fill: "red", shape: "dot", text: "Bus Error" });
							}
						}
						else {
							node.status({ fill: "red", shape: "dot", text: "Bus Error" });
						}

						dev.close();
					}
				}
			}
			else {
				node.status({ fill: "yellow", shape: "dot", text: "Input format error" });
			}

		});

		node.on('close', function () {
			node.device.close();
		});
	}
	RED.nodes.registerType("receive", lw14udr_receive);

}