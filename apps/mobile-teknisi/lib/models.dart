class Repair {
  Repair.fromJson(Map<String, dynamic> json)
      : id = json['id'] as String,
        ticketNumber = json['ticketNumber'] as String,
        customerId = json['customerId'] as String,
        deviceType = json['deviceType'] as String? ?? '',
        brand = json['brand'] as String? ?? '',
        modelName = json['modelName'] as String? ?? '',
        declaredDefects = json['declaredDefects'] as String? ?? '',
        currentState = json['currentState'] as String,
        quotationAmount = json['quotationAmount'] as String?,
        quotationDescription = json['quotationDescription'] as String?;
  final String id, ticketNumber, customerId, deviceType, brand, modelName, declaredDefects, currentState;
  final String? quotationAmount, quotationDescription;
}

class Customer {
  Customer.fromJson(Map<String, dynamic> json)
      : id = json['id'] as String,
        fullName = json['fullName'] as String,
        phoneNumber = json['phoneNumber'] as String;
  final String id, fullName, phoneNumber;
}
