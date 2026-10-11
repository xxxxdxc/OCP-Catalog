import { type LuckinGateway } from './luckin-mcp';
export class FixtureLuckin implements LuckinGateway {
  calls:{name:string;args:any}[]=[];price=16;unknown=false;
  p={productId:11447,productName:'测试拿铁',skuCode:'SKU-HOT',pictureUrl:'',estimatePrice:16,productAttrs:[{attributeId:122,attributeName:'温度',productSubAttrs:[{attributeId:429,attributeName:'热',selected:true,canSelected:1},{attributeId:428,attributeName:'冰',selected:false,canSelected:1}]}]};
  async call(name:string,args:any){this.calls.push({name,args});switch(name){
    case 'queryShopList':return [{deptId:123,deptName:'测试门店',address:'测试路 1 号',distance:0.3,longitude:120,latitude:30}];
    case 'searchProductForMcp':return [structuredClone(this.p)];
    case 'queryProductDetailInfo':return structuredClone(this.p);
    case 'switchProduct':return {...structuredClone(this.p),skuCode:'SKU-ICE',productAttrs:[{...this.p.productAttrs[0],productSubAttrs:this.p.productAttrs[0]!.productSubAttrs.map(v=>({...v,selected:v.attributeId===args.attrOperationParam.subAttr.attributeId}))}]};
    case 'previewOrder':return {discountPrice:this.price*args.productList[0].amount,couponCodeList:['COUPON'],productInfoList:[{additionDesc:args.productList[0].skuCode==='SKU-ICE'?'冰':'热'}]};
    case 'createOrder':if(this.unknown)throw new Error('network timeout');return {orderIdStr:'7639308439653908490',needPay:true,discountPrice:this.price*args.productList[0].amount,payOrderUrl:'weixin://wxpay/bizpayurl?pr=fixture',payOrderQrCodeUrl:'https://example.com/pay'};
    case 'queryOrderDetailInfo':return {orderStatus:60,takeMealCodeInfo:{code:'1234'}};
    default:throw new Error('unexpected tool');
  }}
  async close(){}
}
