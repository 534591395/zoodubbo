/**
 * Created by Corey600 on 2016/6/15.
 */

'use strict';

var net = require('net');
var hessian = require('hessian.js');

/**
 * dubbo ����Э���� body ����󳤶�
 * Э���������󳤶�Ϊ 2^32-1 = 4294967296
 * �������󳤶�Ϊ 100K = 100 * 1024 * 8 = 819200
 *
 * @type {number}
 */
var MAX_LENGTH = 819200;

/**
 * �������Ͷ���
 *
 * @type {{
 *  boolean: string,
 *  int: string,
 *  short: string,
 *  long: string,
 *  double: string,
 *  float: string
 * }}
 */
var typeRef = {
    boolean: 'Z',
    int: 'I',
    short: 'S',
    long: 'J',
    double: 'D',
    float: 'F'
};

/**
 * Create a Service instance
 *
 * @param {ZD} zd ZDʵ��
 * @param {Object} opt ����
 * @returns {Service}
 * @constructor
 */
function Service(zd, opt) {
    if (!(this instanceof Service)) return new Service(zd, opt);
    this._zd = zd;

    this._path = opt.path;
    this._version = opt.version;
    this._timeout = (opt.timeout || '60000') + '';

    this._attchments = {
        $class: 'java.util.HashMap',
        $: {
            'path': this._path,
            'interface': this._path,
            'timeout': this._timeout,
            'version': this._version
        }
    };
}

/**
 * Excute the method
 *
 * @param {String} method ������
 * @param {Array} args �����б�
 * @param {Function} cb �ص�����
 * @public
 */
Service.prototype.excute = function (method, args, cb) {
    var self = this;

    var _method = method;
    var _buffer = self._buildBuffer(method, args);

    var promise =  new Promise(function (resolve, reject) {
        var fromCache = true;
        var tryConnectZoo = true;
        var zoo = self._zd.getZooFromCache(self._path);
        if (zoo) {
            fetchData(null, zoo);
        } else {
            fromCache = false;
            self._zd.getZooFromClient(self._path, self._version, fetchData);
        }

        function fetchData(err, zoo) {
            if (err) {
                return reject(err);
            }
            var client = new net.Socket();
            var bl = 16;
            var host = zoo.host;
            var port = zoo.port;
            var ret = null;
            var chunks = [];
            var heap;

            if (!~zoo.methods.indexOf(_method) && !fromCache) {
                return reject(`can't find the method:${_method}, pls check it!`);
            }

            client.connect(port, host, function () {
                client.write(_buffer);
            });

            client.on('error', function (err) {
                console.log(err);

                // 2s duration reconnect
                if (tryConnectZoo) {
                    tryConnectZoo = false;
                    setTimeout(handleReconnect, 2000);
                }

                function handleReconnect() {
                    tryConnectZoo = true;
                    fromCache = false;
                    return self._zk.getZooFromClient(self._group, self._path, fetchData);// reconnect when err occur
                }
            });

            client.on('data', function (chunk) {
                if (!chunks.length) {
                    var arr = Array.prototype.slice.call(chunk.slice(0, 16));
                    var i = 0;
                    while (i < 3) {
                        bl += arr.pop() * Math.pow(255, i++);
                    }
                }
                chunks.push(chunk);
                heap = Buffer.concat(chunks);
                (heap.length >= bl) && client.destroy();
            });
            client.on('close', function (err) {
                if (err) {
                    return console.log('some err happened, so reconnect, check the err event');
                }
                if (heap[3] !== 20) {
                    ret = heap.slice(18, heap.length - 1).toString(); // error����
                    return reject(ret);
                }
                if (heap[15] === 3 && heap.length < 20) { // �ж��Ƿ�û�з���ֵ
                    ret = 'void return';
                    return resolve(ret);
                }

                try {
                    var offset = heap[16] === 145 ? 17 : 18; // �жϴ�������Ƿ�����
                    var buf = new hessian.DecoderV2(heap.slice(offset, heap.length));
                    var _ret = buf.read();
                    if (_ret instanceof Error || offset === 18) {
                        return reject(_ret);
                    }
                    ret = JSON.stringify(_ret);
                } catch (err) {
                    return reject(err);
                }
                return resolve(ret);
            });
        }
    });

    if (typeof cb !== 'function') {
        return promise;
    }

    return promise
        .then(function (res) {
            setTimeout(function () {
                cb(null, res);
            }, 0);
        })
        .catch(function (err) {
            cb(err);
        });
};

/**
 * �� dubbo����Э�� ��װ����
 * Э���ʽ <header><bodydata>
 * ����Э��ο��ĵ���
 *     http://blog.csdn.net/quhongwei_zhanqiu/article/details/41702829
 *     http://dubbo.io/dubbo_protocol_header.jpg-version=1&modificationDate=1335251744000.jpg
 *
 * @param {String} method ������
 * @param {Array} args �����б�
 * @returns {Buffer}
 * @private
 */
Service.prototype._buildBuffer = function (method, args) {
    var body = this._serializeBody(method, args);
    var head = this._codecHead(body.length);
    return Buffer.concat([head, body]);
};

/**
 * ���봫��Э��ͷ <header>
 * Э��ͷ ���� 16���ֽڣ�128λ��
 *   0-1B dubboЭ��ħ��(short) �̶�Ϊ 0xda 0xbb
 *   2-2B ��Ϣ��־λ
 *   3-3B ״̬λ
 *  4-11B ������Ϣ��id long����
 * 12-15B ������Ϣ��body���� int����
 * -----------------------------------------------------------------------------------------------
 * | Bit offset |        0-7 |      8-15 |            16-20 |    21 |      22 |      23 |  24-31 |
 * -----------------------------------------------------------------------------------------------
 * |          0 | Magic High | Magic Low | Serialization id | event | Two way | Req/res | status |
 * -----------------------------------------------------------------------------------------------
 * |      32-95 | id (long)                                                                      |
 * -----------------------------------------------------------------------------------------------
 * |     96-127 | data length                                                                    |
 * -----------------------------------------------------------------------------------------------
 *
 * @param {Number} length ����
 * @returns {Buffer}
 * @private
 */
Service.prototype._codecHead = function (length) {
    var head = [0xda, 0xbb, 0xc2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    var i = 15;
    if (length > MAX_LENGTH) {
        throw new Error(`Data length too large: ${length}, max payload: ${MAX_LENGTH}`);
    }
    while (256 <= length) {
        head.splice(i--, 1, length % 256);
        length = length >> 8;
    }
    head.splice(i, 1, length);
    return new Buffer(head);
};

/**
 * ���л�����Э���� <bodydata>
 *  1. dubbo�İ汾��Ϣ
 *  2. ����ӿ���
 *  3. ����İ汾��
 *  4. ������ķ�����
 *  5. ������ķ����Ĳ���������
 *  6. ��������Ĳ���ֵ������л�
 *  7. ������������Ϣmap����attachments���л�
 *
 * @param {String} method ������
 * @param {Array} args �����б�
 * @returns {Buffer}
 * @private
 */
Service.prototype._serializeBody = function (method, args) {
    var encoder = new hessian.EncoderV2();

    encoder.write(this._zd._dubbo);
    encoder.write(this._path);
    encoder.write(this._version);
    encoder.write(method);

    var index;
    var len = args.length;

    // ������ķ����Ĳ���������
    var type;
    var _paramTypes = '';
    if (args && len) {
        for (index = 0; index < len; index++) {
            type = args[index]['$class'];
            _paramTypes += type && ~type.indexOf('.')
                ? 'L' + type.replace(/\./gi, '/') + ';'
                : typeRef[type];
        }
    }
    encoder.write(_paramTypes);

    // ��������Ĳ���ֵ������л�
    if (args && len) {
        for (index = 0; index < len; index++) {
            encoder.write(args[index]);
        }
    }

    // ������������Ϣmap����attachments���л�
    encoder.write(this._attchments);

    var byteBuffer = encoder.byteBuffer;
    byteBuffer = byteBuffer.get(0, encoder.byteBuffer._offset);
    return byteBuffer;
};

module.exports = Service;
