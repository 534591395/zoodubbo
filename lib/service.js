/**
 * Created by Corey600 on 2016/6/15.
 */

'use strict';

var hessian = require('hessian.js');

var typeRef = {
    boolean: 'Z',
    int:     'I',
    short:   'S',
    long:    'J',
    double:  'D',
    float:   'F'
};

/**
 * Create a Service instance
 *
 * @param {ZD} zd
 * @param {String} path
 * @returns {Service}
 * @constructor
 */
function Service(zd, path){
    if (!(this instanceof Service)) return new Service(zd, path);
    this._zd = zd;
    this._path = path;
}

/**
 *
 * @param {String} method
 * @param {Array }args
 * @param {Function} cb
 * @public
 */
Service.prototype.excute = function(method, args, cb){
    var self = this;

    var _method         = method;
    var _parameterTypes = '';
    var _arguments      = args;

    if (_arguments.length) {
        for (var i = 0, l = _arguments.length; i < l; i++) {
            type = _arguments[i]['$class'];
            _parameterTypes += type && ~type.indexOf('.')
                ? 'L' + type.replace(/\./gi, '/') + ';'
                : typeRef[type];
        }
        buffer = this.buffer(_method, _parameterTypes, _arguments);
    } else {
        buffer = this.buffer(_method, '');
    }

    self._zd.getZoo(self._path, function(error, zoo){

    });

};

/**
 * �� dubbo ����Э�� ���л�����
 * Э���ʽ <header><bodydata>
 * ����Э��ο��ĵ���
 *     http://blog.csdn.net/quhongwei_zhanqiu/article/details/41702829
 *
 * @param method
 * @param type
 * @param args
 * @returns {Buffer}
 */
Service.prototype.serializeBuffer = function(method, type, args){
    var bufferBody = this.serializeHead(method, type, args);
    var bufferHead = this.serializeBody(bufferBody.length);
    return Buffer.concat([bufferHead, bufferBody]);
};

/**
 * ���л�����Э��ͷ <header>
 * Э��ͷ ���� 16���ֽڣ�128λ��
 * 0-1B dubboЭ��ħ��(short) �̶�Ϊ 0xda 0xbb
 * 2-2B ��Ϣ��־λ��������ʾ��Ϣ��request����//response,twoway����oneway,�������������������Լ�����//�����л������л�Э��
 * 3-3B ״̬λ�� ��Ϣ����Ϊresponseʱ������������Ӧ״̬
 * 4-11B ������Ϣ��id long����
 * 12-16B ������Ϣ��body���� int����
 *
 * @param length
 * @returns {Buffer}
 */
Service.prototype.serializeHead = function(length){
    var head = [0xda, 0xbb, 0xc2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    var i    = 15;

    if (length > DEFAULT_LEN) {
        throw new Error(`Data length too large: ${length}, max payload: ${DEFAULT_LEN}`);
    }
    // ����body������Ϣ
    if (length - 256 < 0) {
        head.splice(i, 1, length - 256);
    } else {
        while (length - 256 > 0) {
            head.splice(i--, 1, length % 256);
            length = length >> 8;
        }
        head.splice(i, 1, length);
    }
    return new Buffer(head);
};

/**
 * ���л�����Э���� <bodydata>
 * @returns {*}
 */
Service.prototype.serializeBody = function(){
    var encoder = new hessian.EncoderV2();
    encoder.write(this._version);
    encoder.write(this._path);
    encoder.write(this._env);
    encoder.write(method);
    encoder.write(type);
    if (args && args.length) {
        for (var i = 0, len = args.length; i < len; ++i) {
            encoder.write(args[i]);
        }
    }
    encoder.write(this._attchments);
    encoder = encoder.byteBuffer._bytes.slice(0, encoder.byteBuffer._offset);

    return encoder;
};

module.exports = Service;
